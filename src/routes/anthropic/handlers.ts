/**
 * Anthropic-compatible route handlers.
 * Implements /v1/messages endpoint.
 *
 * @module routes/anthropic/handlers
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IPlanRepository } from '@/services/plan-repository';
import { RequestRouter, createRequestRouter } from '@/services/request-router';
import { RequestProxy } from '@/services/request-proxy';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import {
  attachProviderMetrics,
  extractAnthropicTokenUsage,
} from '@/middleware/request-logger';
import type {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
} from '@/types/anthropic';
import type { CodingPlan } from '@/types';

/**
 * Schema for system prompt content blocks.
 */
const systemBlockSchema = z.object({
  type: z.enum(['text', 'image']),
}).passthrough();

/**
 * Anthropic message request schema.
 */
const messageRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional().default(false),
  system: z.union([
    z.string(),
    z.array(systemBlockSchema),
  ]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string()).optional(),
  metadata: z.object({ user_id: z.string().optional() }).optional(),
}).passthrough();

/**
 * Anthropic handlers interface.
 */
interface AnthropicHandlers {
  createMessage: (
    request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
    reply: FastifyReply
  ) => Promise<AnthropicMessageResponse | void>;
  getRouter: () => RequestRouter;
}

/**
 * Service dependencies for handlers.
 */
interface HandlerServices {
  repository: IPlanRepository;
  proxy: RequestProxy;
  router: RequestRouter;
}

/**
 * Validate request and return parsed data as AnthropicMessageRequest.
 */
function validateAndParse(request: FastifyRequest<{ Body: AnthropicMessageRequest }>): AnthropicMessageRequest {
  const validation = messageRequestSchema.safeParse(request.body);
  if (!validation.success) {
    throw validation.error;
  }
  // Cast to AnthropicMessageRequest since Zod's inferred type differs from the interface
  // The validation ensures the structure is correct
  return validation.data as AnthropicMessageRequest;
}

/**
 * Get decrypted API key for a plan.
 */
async function fetchApiKey(repository: IPlanRepository, planId: string): Promise<string> {
  const apiKey = await repository.getDecryptedApiKey(planId);
  if (!apiKey) {
    throw createGatewayError('INTERNAL_ERROR', 'Failed to get API key for plan', { planId });
  }
  return apiKey;
}

/**
 * Attach provider metrics and log response.
 */
function recordMetrics(
  request: FastifyRequest,
  plan: CodingPlan,
  model: string,
  response: { durationMs: number; statusCode: number; data: unknown }
): void {
  // Type assertion for token usage extraction
  type AnthropicUsageData = { usage?: { input_tokens?: number; output_tokens?: number } };
  const usageData: AnthropicUsageData | undefined = response.data as AnthropicUsageData | undefined;
  attachProviderMetrics(request, {
    planId: plan.id,
    planName: plan.name,
    model,
    durationMs: response.durationMs,
    statusCode: response.statusCode,
    tokenUsage: usageData ? extractAnthropicTokenUsage(usageData) : undefined,
    providerResponseTimeMs: response.durationMs,
  });
  logger.info('Anthropic message response', {
    requestId: request.id,
    statusCode: response.statusCode,
    durationMs: response.durationMs,
    planId: plan.id,
  });
}

/**
 * Attempt failover to an alternative plan.
 */
async function attemptFailover(
  services: HandlerServices,
  body: AnthropicMessageRequest,
  requestId: string,
  plan: CodingPlan
): Promise<{ durationMs: number; statusCode: number; data: unknown } | null> {
  const apiKey = await fetchApiKey(services.repository, plan.id);
  if (!apiKey) {
    return null;
  }

  try {
    const response = await services.proxy.forwardAnthropicRequest(body, {
      baseUrl: plan.baseUrl,
      apiKey,
      timeout: plan.timeout,
      requestId,
    });
    services.router.markPlanSuccess(plan.id);
    logger.info('Failover successful', { requestId, failoverPlanId: plan.id, durationMs: response.durationMs });
    return response;
  } catch (err) {
    services.router.markPlanFailed(plan.id);
    logger.warn('Failover plan failed', {
      requestId,
      failoverPlanId: plan.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Create Anthropic-compatible route handlers.
 */
// eslint-disable-next-line max-lines-per-function
export function createAnthropicHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy
): AnthropicHandlers {
  const router = createRequestRouter(repository);
  const services: HandlerServices = { repository, proxy, router };

  return {
    // eslint-disable-next-line max-lines-per-function
    async createMessage(
      request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
      reply: FastifyReply
    ): Promise<AnthropicMessageResponse | void> {
      const requestId = request.id;
      const body = validateAndParse(request);
      const model = body.model;

      logger.info('Anthropic message request', {
        requestId, model, stream: body.stream,
        messageCount: body.messages.length, maxTokens: body.max_tokens,
      });

      const routingResult = await router.route(model);
      if (!routingResult.selectedPlan) {
        throw createGatewayError('MODEL_NOT_FOUND', `No coding plan supports model '${model}'`, { model, requestId });
      }

      const plan = routingResult.selectedPlan;
      const apiKey = await fetchApiKey(repository, plan.id);

      logger.debug('Selected plan for request', {
        requestId, planId: plan.id, planName: plan.name,
        alternatives: routingResult.alternativePlans.length,
      });

      // Handle streaming
      if (body.stream) {
        await proxy.forwardAnthropicStream(
          body,
          { baseUrl: plan.baseUrl, apiKey, timeout: plan.timeout, requestId },
          (_chunk, done) => {
            if (done) {
              router.markPlanSuccess(plan.id);
              logger.debug('Stream completed', { requestId });
            }
          },
          reply
        );
        return;
      }

      // Non-streaming request with failover
      try {
        const response = await proxy.forwardAnthropicRequest(body, {
          baseUrl: plan.baseUrl, apiKey, timeout: plan.timeout, requestId,
        });
        router.markPlanSuccess(plan.id);
        recordMetrics(request, plan, model, response);
        return response.data as AnthropicMessageResponse;
      } catch (error) {
        router.markPlanFailed(plan.id);

        for (const altPlan of routingResult.alternativePlans) {
          if (!router.getCircuitBreaker().canExecute(altPlan.id)) {
            continue;
          }

          logger.info('Attempting failover', { requestId, failedPlanId: plan.id, failoverPlanId: altPlan.id });
          const result = await attemptFailover(services, body, requestId, altPlan);
          if (result) {
            recordMetrics(request, altPlan, model, result);
            return result.data as AnthropicMessageResponse;
          }
        }

        throw createGatewayError(
          'UPSTREAM_ERROR',
          'All available plans failed to process the request',
          { requestId, attemptedPlans: [plan.id, ...routingResult.alternativePlans.map(p => p.id)] }
        );
      }
    },

    getRouter(): RequestRouter {
      return router;
    },
  };
}
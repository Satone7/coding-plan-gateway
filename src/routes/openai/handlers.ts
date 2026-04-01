/**
 * OpenAI-compatible route handlers.
 * Implements /v1/chat/completions and /v1/models endpoints.
 *
 * @module routes/openai/handlers
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IPlanRepository } from '@/services/plan-repository';
import { RequestRouter, createRequestRouter } from '@/services/request-router';
import { type ModelAliases } from '@/services/model-resolver';
import { RequestProxy } from '@/services/request-proxy';
import { QuotaManager } from '@/services/quota-manager';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import {
  attachProviderMetrics,
  extractOpenAITokenUsage,
} from '@/middleware/request-logger';
import {
  startStage,
  endStage,
} from '@/middleware/request-timer';
import type { ChatCompletionRequest, ChatCompletionResponse, ModelsResponse } from '@/types/openai';
import type { CodingPlan } from '@/types';

/**
 * OpenAI chat completion request schema.
 * Uses passthrough to preserve unknown fields for transparent proxy behavior.
 * This allows custom parameters (e.g., logprobs, top_logprobs) to pass through
 * to upstream providers without being stripped by Zod validation.
 */
const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    name: z.string().optional(),
  })).min(1),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  user: z.string().optional(),
}).passthrough();

type ValidatedChatCompletion = z.infer<typeof chatCompletionSchema>;

/**
 * OpenAI handlers interface.
 */
interface OpenAIHandlers {
  createChatCompletion: (
    request: FastifyRequest<{ Body: ChatCompletionRequest }>,
    reply: FastifyReply
  ) => Promise<ChatCompletionResponse | void>;
  listModels: (request: FastifyRequest, reply: FastifyReply) => Promise<ModelsResponse>;
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
 * Validate request and return parsed data.
 */
function validateAndParse(request: FastifyRequest<{ Body: ChatCompletionRequest }>): ValidatedChatCompletion {
  startStage(request, 'validation');
  const validation = chatCompletionSchema.safeParse(request.body);
  if (!validation.success) {
    endStage(request, 'validation');
    throw validation.error;
  }
  endStage(request, 'validation');
  return validation.data;
}

/**
 * Get decrypted API key for a plan.
 */
async function fetchApiKey(
  repository: IPlanRepository,
  planId: number,
  request: FastifyRequest
): Promise<string> {
  startStage(request, 'apiKeyDecryption');
  const apiKey = await repository.getDecryptedApiKey(planId);
  endStage(request, 'apiKeyDecryption');
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
  type OpenAIUsageData = { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
  const usageData: OpenAIUsageData | undefined = response.data as OpenAIUsageData | undefined;
  attachProviderMetrics(request, {
    planId: plan.id,
    planName: plan.name,
    model,
    durationMs: response.durationMs,
    statusCode: response.statusCode,
    tokenUsage: usageData ? extractOpenAITokenUsage(usageData) : undefined,
    providerResponseTimeMs: response.durationMs,
  });
  logger.info('Chat completion response', {
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
  body: ValidatedChatCompletion,
  requestId: string,
  plan: CodingPlan,
  request: FastifyRequest,
  canonicalName?: string
): Promise<{ durationMs: number; statusCode: number; data: unknown } | null> {
  const apiKey = await fetchApiKey(services.repository, plan.id, request);
  if (!apiKey) {
    return null;
  }

  // Use the canonical name for the upstream request to avoid model name validation errors
  if (canonicalName) {
    body.model = canonicalName;
  }

  startStage(request, 'upstreamRequest');
  try {
    const response = await services.proxy.forwardOpenAIRequest(body, {
      baseUrl: plan.baseUrl,
      apiKey,
      timeout: plan.timeout,
      requestId,
    });
    endStage(request, 'upstreamRequest');
    services.router.markPlanSuccess(plan.id);
    logger.info('Failover successful', { requestId, failoverPlanId: plan.id, durationMs: response.durationMs });
    return response;
  } catch (err) {
    endStage(request, 'upstreamRequest');
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
 * Create OpenAI-compatible route handlers.
 */
// eslint-disable-next-line max-lines-per-function
export function createOpenAIHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy,
  quotaManager?: QuotaManager,
  modelAliases?: ModelAliases
): OpenAIHandlers {
  const router = createRequestRouter(repository, quotaManager, undefined, modelAliases);
  const services: HandlerServices = { repository, proxy, router };

  return {
    // eslint-disable-next-line max-lines-per-function
    async createChatCompletion(
      request: FastifyRequest<{ Body: ChatCompletionRequest }>,
      reply: FastifyReply
    ): Promise<ChatCompletionResponse | void> {
      const requestId = request.id;
      const body = validateAndParse(request);
      const model = body.model;

      logger.info('Chat completion request', {
        requestId, model, stream: body.stream, messageCount: body.messages.length,
      });

      startStage(request, 'routing');
      const routingResult = await router.route(model);
      endStage(request, 'routing');
      if (!routingResult.selectedPlan) {
        throw createGatewayError('MODEL_NOT_FOUND', `No coding plan supports model '${model}'`, { model, requestId });
      }

      const plan = routingResult.selectedPlan;

      // Consume quota after selecting the plan
      startStage(request, 'quotaCheck');
      if (quotaManager) {
        const consumed = quotaManager.consumeQuota(plan.id);
        if (!consumed) {
          endStage(request, 'quotaCheck');
          throw createGatewayError(
            'QUOTA_EXHAUSTED',
            `Quota exhausted for plan '${plan.name}'`,
            { planId: plan.id, requestId }
          );
        }
      }
      endStage(request, 'quotaCheck');

      const apiKey = await fetchApiKey(repository, plan.id, request);

      logger.debug('Selected plan for request', {
        requestId, planId: plan.id, planName: plan.name,
        alternatives: routingResult.alternativePlans.length,
      });

      // Update the request body to use the canonical name for upstream request
      if (routingResult.canonicalName) {
        body.model = routingResult.canonicalName;
      }

      // Handle streaming
      if (body.stream) {
        startStage(request, 'upstreamRequest');
        try {
          await proxy.forwardOpenAIStream(
            body,
            { baseUrl: plan.baseUrl, apiKey, timeout: plan.timeout, requestId },
            (_chunk, done) => {
              if (done) {
                endStage(request, 'upstreamRequest');
                router.markPlanSuccess(plan.id);
                logger.debug('Stream completed', { requestId });
              }
            },
            reply
          );
        } catch (streamError) {
          endStage(request, 'upstreamRequest');
          router.markPlanFailed(plan.id);
          // Refund quota on stream failure
          if (quotaManager) {
            quotaManager.refundQuota(plan.id);
          }
          throw streamError;
        }
        return;
      }

      // Non-streaming request with failover
      startStage(request, 'upstreamRequest');
      try {
        const response = await proxy.forwardOpenAIRequest(body, {
          baseUrl: plan.baseUrl, apiKey, timeout: plan.timeout, requestId,
        });
        endStage(request, 'upstreamRequest');
        router.markPlanSuccess(plan.id);
        recordMetrics(request, plan, model, response);
        return response.data as ChatCompletionResponse;
      } catch (error) {
        endStage(request, 'upstreamRequest');
        router.markPlanFailed(plan.id);

        // Refund quota on failure
        if (quotaManager) {
          quotaManager.refundQuota(plan.id);
        }

        for (const altPlan of routingResult.alternativePlans) {
          if (!router.getCircuitBreaker().canExecute(altPlan.id)) {
            continue;
          }

          logger.info('Attempting failover', { requestId, failedPlanId: plan.id, failoverPlanId: altPlan.id });
          const result = await attemptFailover(services, body, requestId, altPlan, request, routingResult.canonicalName);
          if (result) {
            recordMetrics(request, altPlan, model, result);
            return result.data as ChatCompletionResponse;
          }
        }

        throw createGatewayError(
          'UPSTREAM_ERROR',
          'All available plans failed to process the request',
          { requestId, attemptedPlans: [plan.id, ...routingResult.alternativePlans.map(p => p.id)] }
        );
      }
    },

    async listModels(request: FastifyRequest, _reply: FastifyReply): Promise<ModelsResponse> {
      const plans = await repository.findActive();
      const modelSet = new Set<string>();

      for (const plan of plans) {
        for (const model of plan.models) {
          modelSet.add(model);
        }
      }

      const models = Array.from(modelSet).map((id) => ({
        id,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: 'coding-plan-gateway',
      }));

      logger.info('List models request', {
        requestId: request.id,
        modelCount: models.length,
        planCount: plans.length,
      });

      return { object: 'list', data: models };
    },

    getRouter(): RequestRouter {
      return router;
    },
  };
}
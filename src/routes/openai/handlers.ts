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
import { RequestProxy } from '@/services/request-proxy';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import {
  attachProviderMetrics,
  extractOpenAITokenUsage,
} from '@/middleware/request-logger';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelsResponse,
} from '@/types/openai';

/**
 * OpenAI chat completion request schema.
 * Validates the request body for chat completion requests.
 */
const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
        name: z.string().optional(),
      })
    )
    .min(1),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  user: z.string().optional(),
});

/**
 * OpenAI handlers interface.
 * Defines the structure of returned handler methods.
 */
interface OpenAIHandlers {
  /** POST /v1/chat/completions handler */
  createChatCompletion: (
    request: FastifyRequest<{ Body: ChatCompletionRequest }>,
    reply: FastifyReply
  ) => Promise<ChatCompletionResponse | void>;
  /** GET /v1/models handler */
  listModels: (
    request: FastifyRequest,
    reply: FastifyReply
  ) => Promise<ModelsResponse>;
  /** Get the internal router instance */
  getRouter: () => RequestRouter;
}

/**
 * Create OpenAI-compatible route handlers with dependency injection.
 *
 * Creates handlers for OpenAI-compatible API endpoints including chat completions
 * and model listing. The handlers integrate with the request router for plan selection
 * and use the request proxy for upstream communication.
 *
 * @param repository - The plan repository for accessing coding plan configurations
 * @param proxy - The request proxy for forwarding requests to upstream providers
 * @returns An object containing handler methods for OpenAI endpoints
 *
 * @example
 * ```typescript
 * const repository = createPlanRepository('./config.yaml', encryptionKey);
 * const proxy = createRequestProxy();
 * const handlers = createOpenAIHandlers(repository, proxy);
 *
 * // Use handlers with Fastify
 * fastify.post('/chat/completions', handlers.createChatCompletion);
 * fastify.get('/models', handlers.listModels);
 * ```
 */
// eslint-disable-next-line max-lines-per-function,@typescript-eslint/explicit-function-return-type
export function createOpenAIHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy
): OpenAIHandlers {
  const router = createRequestRouter(repository);

  return {
    /**
     * POST /v1/chat/completions - Create chat completion.
     */
    async createChatCompletion(
      request: FastifyRequest<{ Body: ChatCompletionRequest }>,
      reply: FastifyReply
    ): Promise<ChatCompletionResponse | void> {
      const requestId = request.id;

      // Validate request
      const validation = chatCompletionSchema.safeParse(request.body);
      if (!validation.success) {
        throw validation.error;
      }

      const body = validation.data;
      const model = body.model;

      logger.info('Chat completion request', {
        requestId,
        model,
        stream: body.stream,
        messageCount: body.messages.length,
      });

      // Route request to best available plan
      const routingResult = await router.route(model);

      if (!routingResult.selectedPlan) {
        throw createGatewayError(
          'MODEL_NOT_FOUND',
          `No coding plan supports model '${model}'`,
          { model, requestId }
        );
      }

      const selectedPlan = routingResult.selectedPlan;

      // Get decrypted API key
      const apiKey = await repository.getDecryptedApiKey(selectedPlan.id);
      if (!apiKey) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Failed to get API key for plan',
          { planId: selectedPlan.id }
        );
      }

      logger.debug('Selected plan for request', {
        requestId,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        alternatives: routingResult.alternativePlans.length,
      });

      // Handle streaming vs non-streaming
      if (body.stream) {
        await proxy.forwardOpenAIStream(
          body,
          {
            baseUrl: selectedPlan.baseUrl,
            apiKey,
            timeout: selectedPlan.timeout,
            requestId,
          },
          (chunk, done) => {
            if (done) {
              router.markPlanSuccess(selectedPlan.id);
              logger.debug('Stream completed', { requestId });
            }
          },
          reply
        );
        return;
      }

      // Non-streaming request with failover
      try {
        const response = await proxy.forwardOpenAIRequest(body, {
          baseUrl: selectedPlan.baseUrl,
          apiKey,
          timeout: selectedPlan.timeout,
          requestId,
        });

        router.markPlanSuccess(selectedPlan.id);

        // Attach provider metrics for logging
        attachProviderMetrics(request, {
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          model: model,
          durationMs: response.durationMs,
          statusCode: response.statusCode,
          tokenUsage: extractOpenAITokenUsage(response.data),
          providerResponseTimeMs: response.durationMs,
        });

        logger.info('Chat completion response', {
          requestId,
          statusCode: response.statusCode,
          durationMs: response.durationMs,
          planId: selectedPlan.id,
        });

        return response.data;
      } catch (error) {
        // Mark plan as failed
        router.markPlanFailed(selectedPlan.id);

        // Try failover to alternative plans
        const alternativePlans = routingResult.alternativePlans;

        for (const altPlan of alternativePlans) {
          if (!router.getCircuitBreaker().canExecute(altPlan.id)) {
            continue;
          }

          logger.info('Attempting failover to alternative plan', {
            requestId,
            failedPlanId: selectedPlan.id,
            failoverPlanId: altPlan.id,
          });

          try {
            const altApiKey = await repository.getDecryptedApiKey(altPlan.id);
            if (!altApiKey) {
              continue;
            }

            const response = await proxy.forwardOpenAIRequest(body, {
              baseUrl: altPlan.baseUrl,
              apiKey: altApiKey,
              timeout: altPlan.timeout,
              requestId,
            });

            router.markPlanSuccess(altPlan.id);

            // Attach provider metrics for logging
            attachProviderMetrics(request, {
              planId: altPlan.id,
              planName: altPlan.name,
              model: model,
              durationMs: response.durationMs,
              statusCode: response.statusCode,
              tokenUsage: extractOpenAITokenUsage(response.data),
              providerResponseTimeMs: response.durationMs,
            });

            logger.info('Failover successful', {
              requestId,
              failoverPlanId: altPlan.id,
              durationMs: response.durationMs,
            });

            return response.data;
          } catch (failoverError) {
            router.markPlanFailed(altPlan.id);
            logger.warn('Failover plan failed', {
              requestId,
              failoverPlanId: altPlan.id,
              error: failoverError instanceof Error ? failoverError.message : String(failoverError),
            });
          }
        }

        // All plans failed
        throw createGatewayError(
          'UPSTREAM_ERROR',
          'All available plans failed to process the request',
          { requestId, attemptedPlans: [selectedPlan.id, ...alternativePlans.map(p => p.id)] }
        );
      }
    },

    /**
     * GET /v1/models - List available models.
     */
    async listModels(
      request: FastifyRequest,
      _reply: FastifyReply
    ): Promise<ModelsResponse> {
      const plans = await repository.findActive();

      // Collect unique models from all active plans
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

      return {
        object: 'list',
        data: models,
      };
    },

    /**
     * Get the router instance for external access.
     */
    getRouter(): RequestRouter {
      return router;
    },
  };
}
/**
 * Anthropic-compatible route handlers.
 * Implements /v1/messages endpoint.
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

/**
 * Anthropic message request schema.
 */
const messageRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional().default(false),
  system: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string()).optional(),
  metadata: z
    .object({
      user_id: z.string().optional(),
    })
    .optional(),
});

/**
 * Create Anthropic handlers with dependencies.
 */
export function createAnthropicHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy
) {
  const router = createRequestRouter(repository);

  return {
    /**
     * POST /v1/messages - Create message.
     */
    async createMessage(
      request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
      reply: FastifyReply
    ): Promise<AnthropicMessageResponse | void> {
      const requestId = request.id;

      // Validate request
      const validation = messageRequestSchema.safeParse(request.body);
      if (!validation.success) {
        throw validation.error;
      }

      const body = validation.data;
      const model = body.model;

      logger.info('Anthropic message request', {
        requestId,
        model,
        stream: body.stream,
        messageCount: body.messages.length,
        maxTokens: body.max_tokens,
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
        await proxy.forwardAnthropicStream(
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
        const response = await proxy.forwardAnthropicRequest(body, {
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
          tokenUsage: extractAnthropicTokenUsage(response.data),
          providerResponseTimeMs: response.durationMs,
        });

        logger.info('Anthropic message response', {
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

            const response = await proxy.forwardAnthropicRequest(body, {
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
              tokenUsage: extractAnthropicTokenUsage(response.data),
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
     * Get the router instance for external access.
     */
    getRouter(): RequestRouter {
      return router;
    },
  };
}
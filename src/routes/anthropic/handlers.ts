/**
 * Anthropic-compatible route handlers.
 * Implements /v1/messages endpoint.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
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

      // Find plans that support this model
      const plans = await repository.findByModel(model);
      const activePlans = plans.filter((p) => p.status === 'active');

      if (activePlans.length === 0) {
        throw createGatewayError(
          'MODEL_NOT_FOUND',
          `No coding plan supports model '${model}'`
        );
      }

      // For now, use the first available plan
      // TODO: Implement proper plan selection with quota awareness (Phase 5)
      const selectedPlan = activePlans[0];

      if (!selectedPlan) {
        throw createGatewayError(
          'SERVICE_UNAVAILABLE',
          'No plan available for this request'
        );
      }

      logger.debug('Selected plan for request', {
        requestId,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
      });

      // Get decrypted API key
      const apiKey = await repository.getDecryptedApiKey(selectedPlan.id);
      if (!apiKey) {
        throw createGatewayError(
          'INTERNAL_ERROR',
          'Failed to get API key for plan'
        );
      }

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
            // Chunk callback - could track usage here
            if (done) {
              logger.debug('Stream completed', { requestId });
            }
          },
          reply
        );
        return;
      }

      // Non-streaming request
      const response = await proxy.forwardAnthropicRequest(body, {
        baseUrl: selectedPlan.baseUrl,
        apiKey,
        timeout: selectedPlan.timeout,
        requestId,
      });

      logger.info('Anthropic message response', {
        requestId,
        statusCode: response.statusCode,
        durationMs: response.durationMs,
      });

      return response.data;
    },
  };
}
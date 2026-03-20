/**
 * OpenAI-compatible route handlers.
 * Implements /v1/chat/completions and /v1/models endpoints.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type { IPlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelsResponse,
} from '@/types/openai';

/**
 * OpenAI chat completion request schema.
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
 * Create OpenAI handlers with dependencies.
 */
export function createOpenAIHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy
) {
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
        await proxy.forwardOpenAIStream(
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
      const response = await proxy.forwardOpenAIRequest(body, {
        baseUrl: selectedPlan.baseUrl,
        apiKey,
        timeout: selectedPlan.timeout,
        requestId,
      });

      logger.info('Chat completion response', {
        requestId,
        statusCode: response.statusCode,
        durationMs: response.durationMs,
      });

      return response.data;
    },

    /**
     * GET /v1/models - List available models.
     */
    async listModels(
      request: FastifyRequest,
      reply: FastifyReply
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
  };
}
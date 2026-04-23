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
import { QuotaManager } from '@/services/quota-manager';
import type { ProviderRegistry } from '@/services/provider-registry';
import { logger } from '@/utils/logger';
import { createGatewayError } from '@/types';
import {
  attachProviderMetrics,
  extractAnthropicTokenUsage,
} from '@/middleware/request-logger';
import {
  startStage,
  endStage,
} from '@/middleware/request-timer';
import {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicCountTokensRequest,
  AnthropicCountTokensResponse,
} from '@/types/anthropic';
import type { ChatCompletionResponse } from '@/types/openai';
import type { CodingPlan } from '@/types';
import { TokenCounter } from '@/utils/token-counter';
import {
  convertAnthropicToOpenAIRequest,
  convertOpenAIToAnthropicResponse,
} from '@/utils/format-converter';

/** Check if a plan's upstream expects OpenAI format (requires cross-format conversion).
 * Default to 'anthropic' if apiFormat is not specified. */
function needsOpenAIUpstream(plan: CodingPlan): boolean {
  return plan.apiFormat === 'openai_chat';
}

/** Get the appropriate base URL for forwarding based on upstream format.
 * For Anthropic format (default), returns baseUrl (always available).
 * For OpenAI format, returns openaiBaseUrl if available, undefined otherwise. */
function getUpstreamBaseUrl(plan: CodingPlan, useOpenAIUpstream: boolean): string | undefined {
  if (useOpenAIUpstream) {
    return plan.openaiBaseUrl;
  }
  return plan.baseUrl;
}

/**
 * Schema for system prompt content blocks.
 */
const systemBlockSchema = z.object({
  type: z.enum(['text', 'image', 'document']),
}).passthrough();

/**
 * Anthropic message request schema.
 * Uses passthrough to preserve unknown fields for transparent proxy behavior.
 * This allows custom parameters to pass through to upstream providers without
 * being stripped by Zod validation, matching OpenAI endpoint behavior.
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
 * Anthropic count tokens request schema.
 * Uses passthrough to preserve unknown fields.
 */
const countTokensRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  system: z.union([
    z.string(),
    z.array(systemBlockSchema),
  ]).optional(),
}).passthrough();

/**
 * Anthropic handlers interface.
 */
interface AnthropicHandlers {
  createMessage: (
    request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
    reply: FastifyReply
  ) => Promise<AnthropicMessageResponse | void>;
  countTokens: (
    request: FastifyRequest<{ Body: AnthropicCountTokensRequest }>,
    reply: FastifyReply
  ) => Promise<AnthropicCountTokensResponse | void>;
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
  startStage(request, 'validation');
  const validation = messageRequestSchema.safeParse(request.body);
  if (!validation.success) {
    endStage(request, 'validation');
    throw validation.error;
  }
  endStage(request, 'validation');
  // Cast to AnthropicMessageRequest since Zod's inferred type differs from the interface
  // The validation ensures the structure is correct
  return validation.data as AnthropicMessageRequest;
}

/**
 * Validate count tokens request and return parsed data.
 */
function validateAndParseCountTokens(request: FastifyRequest<{ Body: AnthropicCountTokensRequest }>): AnthropicCountTokensRequest {
  startStage(request, 'validation');
  const validation = countTokensRequestSchema.safeParse(request.body);
  if (!validation.success) {
    endStage(request, 'validation');
    throw validation.error;
  }
  endStage(request, 'validation');
  return validation.data as AnthropicCountTokensRequest;
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
  request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
  plan: CodingPlan,
  model: string,
  response: { durationMs: number; statusCode: number; data: unknown }
): void {
  // Type assertion for token usage extraction
  type AnthropicUsageData = {
    usage?: { input_tokens?: number; output_tokens?: number };
    content?: Array<{ type?: string; text?: string }>;
  };
  const responseData = response.data as AnthropicUsageData | undefined;
  
  let tokenUsage = responseData ? extractAnthropicTokenUsage(responseData) : undefined;
  
  let outputText: string | undefined;
  if (responseData?.content && Array.isArray(responseData.content)) {
    outputText = '';
    for (const block of responseData.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        outputText += block.text;
      }
    }
  }

  tokenUsage = TokenCounter.buildTokenUsageWithFallback(
    tokenUsage,
    request.body,
    'anthropic',
    outputText,
    request.id
  );

  attachProviderMetrics(request, {
    planId: plan.id,
    planName: plan.name,
    model,
    durationMs: response.durationMs,
    statusCode: response.statusCode,
    tokenUsage,
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
  plan: CodingPlan,
  request: FastifyRequest<{ Body: AnthropicMessageRequest }>,
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

  // Check if upstream URL is available
  const useOpenAIUpstream = needsOpenAIUpstream(plan);
  const upstreamUrl = getUpstreamBaseUrl(plan, useOpenAIUpstream);
  if (!upstreamUrl) {
    logger.warn('Failover plan lacks OpenAI base_url', {
      requestId,
      failoverPlanId: plan.id,
      planName: plan.name,
    });
    return null;
  }

  startStage(request, 'upstreamRequest');
  try {
    let response: { durationMs: number; statusCode: number; data: unknown };
    if (useOpenAIUpstream) {
      const openaiBody = convertAnthropicToOpenAIRequest(body);
      const upstreamResponse = await services.proxy.forwardOpenAIRequest(openaiBody, {
        baseUrl: upstreamUrl,
        apiKey,
        timeout: plan.timeout,
        requestId,
      });
      const anthropicResponse = convertOpenAIToAnthropicResponse(upstreamResponse.data as ChatCompletionResponse);
      response = { durationMs: upstreamResponse.durationMs, statusCode: upstreamResponse.statusCode, data: anthropicResponse };
    } else {
      response = await services.proxy.forwardAnthropicRequest(body, {
        baseUrl: upstreamUrl,
        apiKey,
        timeout: plan.timeout,
        requestId,
      });
    }
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
 * Create Anthropic-compatible route handlers.
 */
// eslint-disable-next-line max-lines-per-function
export function createAnthropicHandlers(
  repository: IPlanRepository,
  proxy: RequestProxy,
  quotaManager?: QuotaManager,
  providerRegistry?: ProviderRegistry
): AnthropicHandlers {
  const router = createRequestRouter(repository, quotaManager, undefined, providerRegistry);
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

      startStage(request, 'routing');
      const routingResult = await router.route(model, requestId);
      endStage(request, 'routing');
      if (!routingResult.selectedPlan) {
        throw createGatewayError('MODEL_NOT_FOUND', `No coding plan supports model '${model}'`, { model, requestId });
      }

      const plan = routingResult.selectedPlan;

      // Check if upstream URL is available for the requested format
      const useOpenAIUpstream = needsOpenAIUpstream(plan);
      const upstreamUrl = getUpstreamBaseUrl(plan, useOpenAIUpstream);
      if (!upstreamUrl) {
        throw createGatewayError(
          'SERVICE_UNAVAILABLE',
          `Plan '${plan.name}' does not support OpenAI-format requests for upstream. Provider lacks OpenAI base_url.`,
          { planId: plan.id, planName: plan.name, provider: plan.provider }
        );
      }

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

      // Attach provider metrics early so onResponse hook always has plan/model info
      // (non-streaming will overwrite with full metrics via recordMetrics)
      attachProviderMetrics(request, {
        planId: plan.id,
        planName: plan.name,
        model,
        canonicalModel: routingResult.canonicalName !== model ? routingResult.canonicalName : undefined,
        durationMs: 0,
        statusCode: 0,
      });

      // Handle streaming
      if (body.stream) {
        startStage(request, 'upstreamRequest');
        try {
          if (useOpenAIUpstream) {
            // Cross-format: client sends Anthropic, upstream expects OpenAI
            await proxy.forwardAnthropicStreamAsOpenAI(
              body,
              { baseUrl: upstreamUrl, apiKey, timeout: plan.timeout, requestId },
              reply,
              (tokenUsage, accumulatedText) => {
                endStage(request, 'upstreamRequest');
                router.markPlanSuccess(plan.id);
                const finalTokenUsage = TokenCounter.buildTokenUsageWithFallback(
                  tokenUsage,
                  body,
                  'openai',
                  accumulatedText,
                  requestId
                );

                attachProviderMetrics(request, {
                  planId: plan.id,
                  planName: plan.name,
                  model,
                  durationMs: Date.now() - (request.startTime || Date.now()),
                  statusCode: 200,
                  tokenUsage: finalTokenUsage,
                });
              }
            );
          } else {
            await proxy.forwardAnthropicStream(
              body,
              { baseUrl: upstreamUrl, apiKey, timeout: plan.timeout, requestId },
              (_chunk, done) => {
                if (done) {
                  endStage(request, 'upstreamRequest');
                  router.markPlanSuccess(plan.id);
                  logger.debug('Stream completed', { requestId });
                }
              },
              reply,
              (tokenUsage, accumulatedText) => {
                const finalTokenUsage = TokenCounter.buildTokenUsageWithFallback(
                  tokenUsage,
                  body,
                  'anthropic',
                  accumulatedText,
                  requestId
                );

                attachProviderMetrics(request, {
                  planId: plan.id,
                  planName: plan.name,
                  model,
                  durationMs: Date.now() - (request.startTime || Date.now()),
                  statusCode: 200,
                  tokenUsage: finalTokenUsage,
                });
              }
            );
          }
        } catch (streamError) {
          endStage(request, 'upstreamRequest');
          router.markPlanFailed(plan.id);
          // Refund quota on stream failure
          if (quotaManager) {
            quotaManager.refundQuota(plan.id);
          }
          // If SSE headers were already sent, the error event has been
          // delivered to the client — do not throw to avoid crash.
          if (!reply.raw.headersSent) {
            throw streamError;
          }
        }
        return;
      }

      // Non-streaming request with failover
      startStage(request, 'upstreamRequest');
      try {
        let anthropicResponse: AnthropicMessageResponse;
        if (useOpenAIUpstream) {
          const openaiBody = convertAnthropicToOpenAIRequest(body);
          const upstreamResponse = await proxy.forwardOpenAIRequest(openaiBody, {
            baseUrl: upstreamUrl, apiKey, timeout: plan.timeout, requestId,
          });
          anthropicResponse = convertOpenAIToAnthropicResponse(upstreamResponse.data as ChatCompletionResponse);
          endStage(request, 'upstreamRequest');
          router.markPlanSuccess(plan.id);
          recordMetrics(request, plan, model, {
            data: anthropicResponse,
            durationMs: upstreamResponse.durationMs,
            statusCode: upstreamResponse.statusCode,
          });
        } else {
          const response = await proxy.forwardAnthropicRequest(body, {
            baseUrl: upstreamUrl, apiKey, timeout: plan.timeout, requestId,
          });
          endStage(request, 'upstreamRequest');
          router.markPlanSuccess(plan.id);
          recordMetrics(request, plan, model, response);
          anthropicResponse = response.data as AnthropicMessageResponse;
        }
        return anthropicResponse;
      } catch (error) {
        endStage(request, 'upstreamRequest');
        logger.warn('Primary plan request failed', {
          requestId,
          planId: plan.id,
          planName: plan.name,
          model,
          error: error instanceof Error ? error.message : String(error),
        });
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

    async countTokens(
      request: FastifyRequest<{ Body: AnthropicCountTokensRequest }>,
      reply: FastifyReply
    ): Promise<AnthropicCountTokensResponse | void> {
      const requestId = request.id;
      const body = validateAndParseCountTokens(request);
      const model = body.model;

      logger.info('Anthropic count tokens request', {
        requestId, model, messageCount: body.messages.length
      });

      startStage(request, 'routing');
      const routingResult = await router.route(model, requestId);
      endStage(request, 'routing');
      if (!routingResult.selectedPlan) {
        throw createGatewayError('MODEL_NOT_FOUND', `No coding plan supports model '${model}'`, { model, requestId });
      }

      const plan = routingResult.selectedPlan;

      // Check if upstream URL is available (count_tokens always uses Anthropic format)
      const upstreamUrl = getUpstreamBaseUrl(plan, false);
      if (!upstreamUrl) {
        throw createGatewayError(
          'SERVICE_UNAVAILABLE',
          `Plan '${plan.name}' does not have a valid base_url.`,
          { planId: plan.id, planName: plan.name }
        );
      }

      // Note: We don't consume quota for count_tokens as it's generally free/cheap and doesn't generate tokens

      const apiKey = await fetchApiKey(repository, plan.id, request);

      logger.debug('Selected plan for count tokens request', {
        requestId, planId: plan.id, planName: plan.name,
      });

      if (routingResult.canonicalName) {
        body.model = routingResult.canonicalName;
      }

      startStage(request, 'upstreamRequest');
      try {
        const response = await proxy.forwardAnthropicCountTokensRequest(body, {
          baseUrl: upstreamUrl, apiKey, timeout: plan.timeout, requestId,
        });
        endStage(request, 'upstreamRequest');
        // Do not mark circuit breaker success/failure for count_tokens to avoid skewing stats
        
        attachProviderMetrics(request, {
          planId: plan.id,
          planName: plan.name,
          model,
          canonicalModel: routingResult.canonicalName !== model ? routingResult.canonicalName : undefined,
          durationMs: response.durationMs,
          statusCode: response.statusCode,
          providerResponseTimeMs: response.durationMs,
        });
        
        return response.data as AnthropicCountTokensResponse;
      } catch (error) {
        endStage(request, 'upstreamRequest');
        const errStatusCode = (error as { statusCode?: number }).statusCode || 500;
        
        attachProviderMetrics(request, {
          planId: plan.id,
          planName: plan.name,
          model,
          durationMs: request.startTime ? Date.now() - request.startTime : 0,
          statusCode: errStatusCode,
        });

        logger.warn('Count tokens request failed', {
          requestId,
          planId: plan.id,
          planName: plan.name,
          model,
          error: error instanceof Error ? error.message : String(error),
        });

        // Try alternatives
        for (const altPlan of routingResult.alternativePlans) {
          if (!router.getCircuitBreaker().canExecute(altPlan.id)) {
            continue;
          }

          logger.info('Attempting failover for count tokens', { requestId, failedPlanId: plan.id, failoverPlanId: altPlan.id });
          const altApiKey = await fetchApiKey(services.repository, altPlan.id, request);
          if (!altApiKey) {
            continue;
          }

          // Check if upstream URL is available for alt plan
          const altUpstreamUrl = getUpstreamBaseUrl(altPlan, false);
          if (!altUpstreamUrl) {
            logger.warn('Failover plan lacks base_url for count tokens', {
              requestId,
              failoverPlanId: altPlan.id,
              planName: altPlan.name,
            });
            continue;
          }

          if (routingResult.canonicalName) {
            body.model = routingResult.canonicalName;
          }

          startStage(request, 'upstreamRequest');
          try {
            const result = await proxy.forwardAnthropicCountTokensRequest(body, {
              baseUrl: altUpstreamUrl, apiKey: altApiKey, timeout: altPlan.timeout, requestId
            });
            endStage(request, 'upstreamRequest');
            
            attachProviderMetrics(request, {
              planId: altPlan.id,
              planName: altPlan.name,
              model,
              durationMs: result.durationMs,
              statusCode: result.statusCode,
              providerResponseTimeMs: result.durationMs,
            });
            
            return result.data as AnthropicCountTokensResponse;
          } catch (altError) {
            endStage(request, 'upstreamRequest');
            const altErrStatusCode = (altError as { statusCode?: number }).statusCode || 500;
            
            attachProviderMetrics(request, {
              planId: altPlan.id,
              planName: altPlan.name,
              model,
              durationMs: request.startTime ? Date.now() - request.startTime : 0,
              statusCode: altErrStatusCode,
            });

            logger.warn('Failover count tokens failed', {
              requestId,
              failoverPlanId: altPlan.id,
              error: altError instanceof Error ? altError.message : String(altError),
            });
          }
        }

        logger.warn('All plans failed for count tokens, falling back to local estimation', {
          requestId,
        });
        
        const estimatedTokens = TokenCounter.estimateAnthropicInputTokens(body);
        
        // Attach success metrics for the local fallback to prevent error logging
        attachProviderMetrics(request, {
          planId: plan.id,
          planName: plan.name,
          model,
          durationMs: request.startTime ? Date.now() - request.startTime : 0,
          statusCode: 200,
        });

        return { input_tokens: estimatedTokens } as AnthropicCountTokensResponse;
      }
    },

    getRouter(): RequestRouter {
      return router;
    },
  };
}
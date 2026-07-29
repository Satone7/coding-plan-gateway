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
import { createModelRoutingService } from '@/services/model-router';
import { RequestProxy } from '@/services/request-proxy';
import { QuotaManager } from '@/services/quota-manager';
import type { ProviderRegistry } from '@/services/provider-registry';
import { logger } from '@/utils/logger';
import { isRetryableUpstreamError } from '@/utils/retryable-error';
import { createGatewayError } from '@/types';
import {
  attachProviderMetrics,
  extractOpenAITokenUsage,
  logStreamingResponse,
} from '@/middleware/request-logger';
import {
  startStage,
  endStage,
  getRequestTimer,
} from '@/middleware/request-timer';
import type { ChatCompletionRequest, ChatCompletionResponse, ModelsResponse, Model } from '@/types/openai';
import type { CodingPlan } from '@/types';
import type { LoadBalanceConfig } from '@/types/load-balancing';
import type { ModelRoutingConfig } from '@/types/model-routing';
import { TokenCounter } from '@/utils/token-counter';
import { findModelInfo } from '@/config/model-info';

/**
 * Tool call schema for assistant messages.
 */
const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

/**
 * OpenAI chat completion request schema.
 * Uses passthrough to preserve unknown fields for transparent proxy behavior.
 * This allows custom parameters (e.g., logprobs, top_logprobs) to pass through
 * to upstream providers without being stripped by Zod validation.
 *
 * Supports full OpenAI message format including:
 * - tool role for function calling responses
 * - tool_calls for assistant messages with function calls
 * - content can be null when tool_calls are present
 */
const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool', 'function']),
    content: z.union([
      z.string(),
      z.null(),  // Allow null for assistant messages with tool_calls
      z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('text'),
          text: z.string(),
        }),
        z.object({
          type: z.literal('image_url'),
          image_url: z.object({
            url: z.string(),
            detail: z.enum(['auto', 'low', 'high']).optional(),
          }).optional(),
        }),
      ]))
    ]).optional(),  // Content is optional when tool_calls present
    name: z.string().optional(),
    tool_call_id: z.string().optional(),  // Required for tool role
    tool_calls: z.array(toolCallSchema).optional(),  // For assistant messages
  }).passthrough()).min(1),  // Allow additional fields per message
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  user: z.string().optional(),
  // Tool/function calling configuration
  tools: z.array(z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      description: z.string().optional(),
      parameters: z.record(z.unknown()).optional(),
    }).passthrough(),
  }).passthrough()).optional(),
  tool_choice: z.union([
    z.literal('none'),
    z.literal('auto'),
    z.literal('required'),
    z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
  ]).optional(),
  // Parallel tool calls (OpenAI feature)
  parallel_tool_calls: z.boolean().optional(),
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
  getModel: (
    request: FastifyRequest<{ Params: { model: string } }>,
    reply: FastifyReply
  ) => Promise<Model>;
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
  request: FastifyRequest<{ Body: ChatCompletionRequest }>,
  plan: CodingPlan,
  model: string,
  response: { durationMs: number; statusCode: number; data: unknown }
): void {
  // Type assertion for token usage extraction
  type OpenAIUsageData = {
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    choices?: Array<{ message?: { content?: string } }>;
  };
  const responseData = response.data as OpenAIUsageData | undefined;
  
  let tokenUsage = responseData ? extractOpenAITokenUsage(responseData) : undefined;
  
  let outputText: string | undefined;
  if (responseData?.choices && Array.isArray(responseData.choices)) {
    outputText = '';
    for (const choice of responseData.choices) {
      if (typeof choice.message?.content === 'string') {
        outputText += choice.message.content;
      }
    }
  }

  tokenUsage = TokenCounter.buildTokenUsageWithFallback(
    tokenUsage,
    request.body,
    'openai',
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
  logger.info('Chat completion response', {
    requestId: request.id,
    statusCode: response.statusCode,
    durationMs: response.durationMs,
    planId: plan.id,
  });
}

/**
 * Whether an upstream error is worth retrying on an alternative plan.
 * Shared with the Anthropic handler — see `src/utils/retryable-error.ts`.
 */

/**
 * Attempt failover to an alternative plan.
 */
async function attemptFailover(
  services: HandlerServices,
  body: ValidatedChatCompletion,
  requestId: string,
  plan: CodingPlan,
  request: FastifyRequest<{ Body: ChatCompletionRequest }>,
  canonicalName?: string
): Promise<{ durationMs: number; statusCode: number; data: unknown } | null> {
  // Check if plan has OpenAI base URL
  if (!plan.openaiBaseUrl) {
    logger.warn('Failover plan lacks OpenAI base_url', {
      requestId,
      failoverPlanId: plan.id,
      planName: plan.name,
    });
    return null;
  }

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
      baseUrl: plan.openaiBaseUrl,
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
  providerRegistry?: ProviderRegistry,
  loadBalanceConfig?: LoadBalanceConfig,
  modelRoutingConfig?: ModelRoutingConfig
): OpenAIHandlers {
  const router = createRequestRouter(repository, quotaManager, loadBalanceConfig, providerRegistry);
  const modelRouter = createModelRoutingService(modelRoutingConfig);
  const services: HandlerServices = { repository, proxy, router };

  return {
    // eslint-disable-next-line max-lines-per-function
    async createChatCompletion(
      request: FastifyRequest<{ Body: ChatCompletionRequest }>,
      reply: FastifyReply
    ): Promise<ChatCompletionResponse | void> {
      const requestId = request.id;
      const body = validateAndParse(request);
      const requestedModel = body.model;

      logger.info('Chat completion request', {
        requestId, model: requestedModel, stream: body.stream, messageCount: body.messages.length,
      });

      // Content-aware model routing: may rewrite the requested model (e.g. k3 →
      // k3-256k when the input fits in 256k). Runs before plan selection; the
      // plan-selection pipeline stays model-name-keyed and unchanged.
      let model = requestedModel;
      startStage(request, 'modelRouting');
      const modelRoutingOutcome = modelRouter.resolve({ requestedModel, body, format: 'openai' });
      endStage(request, 'modelRouting');
      if (modelRoutingOutcome.rewritten) {
        model = modelRoutingOutcome.model;
        body.model = model;
      }

      // Route to plan with OpenAI support (must have openaiBaseUrl)
      startStage(request, 'routing');
      const routingResult = await router.routeForOpenAI(model, requestId);
      endStage(request, 'routing');
      if (!routingResult.selectedPlan) {
        throw createGatewayError('MODEL_NOT_FOUND', `No coding plan with OpenAI-format support for model '${model}'`, { model, requestId });
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

      // Handle streaming - forward OpenAI request to OpenAI endpoint directly
      if (body.stream) {
        // Hijacked replies bypass Fastify's onResponse lifecycle, so we must
        // manually log completion and the timing summary after the stream ends.
        // Both helpers are idempotent: if the raw response's finish event
        // later fires the onResponse hook, it will skip the duplicate output.
        const logCompletion = (): void => {
          startStage(request, 'responseSent');
          endStage(request, 'responseSent');
          if (reply.statusCode >= 400) {
            getRequestTimer(request).markIncomplete();
          }
          getRequestTimer(request).logSummary();
          logStreamingResponse(request, reply);
        };

        startStage(request, 'upstreamRequest');
        try {
          await proxy.forwardOpenAIStream(
            body,
            { baseUrl: plan.openaiBaseUrl!, apiKey, timeout: plan.timeout, requestId },
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
          logCompletion();
          return; // primary plan succeeded
        } catch (primaryError) {
          endStage(request, 'upstreamRequest');
          router.markPlanFailed(plan.id);
          // Refund quota on stream failure
          if (quotaManager) {
            quotaManager.refundQuota(plan.id);
          }

          // Failover: only when the upstream rejected before streaming started
          // (client SSE headers not yet sent) AND the error is retryable (400/429).
          if (isRetryableUpstreamError(primaryError) && !reply.raw.headersSent) {
            for (const altPlan of routingResult.alternativePlans) {
              if (!router.getCircuitBreaker().canExecute(altPlan.id) || !altPlan.openaiBaseUrl) {
                continue;
              }
              // Charge the alternative plan for the request it is about to serve.
              // The matching refund on failure below makes this net-zero if the
              // attempt fails, so the serving plan is the only one charged.
              if (quotaManager && !quotaManager.consumeQuota(altPlan.id)) {
                continue; // alternative exhausted — try the next one
              }
              logger.info('Attempting streaming failover', {
                requestId, failedPlanId: plan.id, failoverPlanId: altPlan.id,
              });
              // Use the canonical model name for the upstream request
              if (routingResult.canonicalName) {
                body.model = routingResult.canonicalName;
              }
              try {
                const altApiKey = await fetchApiKey(repository, altPlan.id, request);
                startStage(request, 'upstreamRequest');
                await proxy.forwardOpenAIStream(
                  body,
                  { baseUrl: altPlan.openaiBaseUrl, apiKey: altApiKey, timeout: altPlan.timeout, requestId },
                  (_chunk, done) => {
                    if (done) {
                      endStage(request, 'upstreamRequest');
                      router.markPlanSuccess(altPlan.id);
                    }
                  },
                  reply,
                  (tokenUsage, accumulatedText) => {
                    const finalTokenUsage = TokenCounter.buildTokenUsageWithFallback(
                      tokenUsage,
                      body,
                      'openai',
                      accumulatedText,
                      requestId
                    );
                    attachProviderMetrics(request, {
                      planId: altPlan.id,
                      planName: altPlan.name,
                      model,
                      durationMs: Date.now() - (request.startTime || Date.now()),
                      statusCode: 200,
                      tokenUsage: finalTokenUsage,
                    });
                  }
                );
                logCompletion();
                return; // failover succeeded
              } catch (altError) {
                endStage(request, 'upstreamRequest');
                router.markPlanFailed(altPlan.id);
                if (quotaManager) {
                  quotaManager.refundQuota(altPlan.id);
                }
                // If the alt plan started streaming then failed, the SSE error
                // event was already delivered to the client — cannot try further.
                if (reply.raw.headersSent) {
                  logCompletion();
                  return;
                }
                // otherwise continue to the next alternative plan
              }
            }
            // All alternatives exhausted and client headers still not sent:
            // surface the primary plan's original error (per fallback policy).
            throw primaryError;
          }

          // Non-retryable error, or headers already sent mid-stream.
          if (!reply.raw.headersSent) {
            throw primaryError;
          }
          // headers already sent — handleStreamError already wrote an SSE error event.
          logCompletion();
        }
        return;
      }

      // Non-streaming request with failover
      startStage(request, 'upstreamRequest');
      try {
        const response = await proxy.forwardOpenAIRequest(body, {
          baseUrl: plan.openaiBaseUrl!, apiKey, timeout: plan.timeout, requestId,
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
          // Charge the alternative plan for the request it is about to serve;
          // refund below if the attempt fails (net-zero for a failed attempt).
          if (quotaManager && !quotaManager.consumeQuota(altPlan.id)) {
            continue; // alternative exhausted — try the next one
          }

          logger.info('Attempting failover', { requestId, failedPlanId: plan.id, failoverPlanId: altPlan.id });
          const result = await attemptFailover(services, body, requestId, altPlan, request, routingResult.canonicalName);
          if (result) {
            recordMetrics(request, altPlan, model, result);
            return result.data as ChatCompletionResponse;
          }
          // attemptFailover returned null (failed) — refund the quota we charged.
          if (quotaManager) {
            quotaManager.refundQuota(altPlan.id);
          }
        }

        // All alternatives exhausted — surface the primary plan's original error
        // (preserves upstream statusCode/JSON, e.g. 429 AccountQuotaExceeded)
        // instead of a generic UPSTREAM_ERROR, per the "pass through primary" policy.
        throw error;
      }
    },

    async listModels(request: FastifyRequest, _reply: FastifyReply): Promise<ModelsResponse> {
      const plans = await repository.findActive();
      const modelSet = new Set<string>();

      for (const plan of plans) {
        for (const model of plan.models) {
          modelSet.add(model);
        }
        if (plan.modelAliases) {
          for (const [alias, target] of Object.entries(plan.modelAliases)) {
            if (plan.models.some((m) => m.toLowerCase() === target.toLowerCase())) {
              modelSet.add(alias);
            }
          }
        }
      }

      const models: Model[] = Array.from(modelSet).map((id) => {
        const modelInfo = findModelInfo(id);
        return {
          id,
          object: 'model' as const,
          created: Math.floor(Date.now() / 1000),
          owned_by: 'coding-plan-gateway',
          context_window: modelInfo?.info.contextWindow,
          max_output_tokens: modelInfo?.info.maxOutputTokens,
          supports_vision: modelInfo?.info.supportsVision,
          supports_tools: modelInfo?.info.supportsTools,
          provider: modelInfo?.provider,
        };
      });

      logger.info('List models request', {
        requestId: request.id,
        modelCount: models.length,
        planCount: plans.length,
      });

      return { object: 'list', data: models };
    },

    async getModel(
      request: FastifyRequest<{ Params: { model: string } }>,
      reply: FastifyReply
    ): Promise<Model> {
      const modelId = request.params.model;
      const plans = await repository.findActive();

      // Check if model is available in any plan
      let found = false;
      let provider: string | undefined;
      for (const plan of plans) {
        if (plan.models.some((m) => m.toLowerCase() === modelId.toLowerCase())) {
          found = true;
          provider = plan.provider;
          break;
        }
        if (plan.modelAliases?.[modelId]) {
          found = true;
          provider = plan.provider;
          break;
        }
      }

      if (!found) {
        throw createGatewayError('MODEL_NOT_FOUND', `Model '${modelId}' not found`, { model: modelId });
      }

      const modelInfo = findModelInfo(modelId);
      const model: Model = {
        id: modelId,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: 'coding-plan-gateway',
        context_window: modelInfo?.info.contextWindow,
        max_output_tokens: modelInfo?.info.maxOutputTokens,
        supports_vision: modelInfo?.info.supportsVision,
        supports_tools: modelInfo?.info.supportsTools,
        provider: modelInfo?.provider ?? provider,
      };

      logger.info('Get model request', {
        requestId: request.id,
        model: modelId,
        contextWindow: model.context_window,
      });

      return model;
    },

    getRouter(): RequestRouter {
      return router;
    },
  };
}
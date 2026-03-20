/**
 * Request logging middleware.
 * Logs all incoming requests and their responses with detailed metrics.
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { logger, createRequestLogger } from '@/utils/logger';

/**
 * Token usage information extracted from responses.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Provider metrics for request tracking.
 */
export interface ProviderMetrics {
  planId: string;
  planName: string;
  model: string;
  durationMs: number;
  statusCode: number;
  tokenUsage?: TokenUsage;
  providerResponseTimeMs?: number;
}

/**
 * Request context attached to request object.
 */
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    requestLogger?: ReturnType<typeof createRequestLogger>;
    providerMetrics?: ProviderMetrics;
  }
}

/**
 * Request logging middleware.
 * Logs request start and end with timing information.
 */
export async function requestLoggerMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = request.id;

  // Attach request-scoped logger
  request.requestLogger = createRequestLogger(requestId);
  request.startTime = Date.now();

  // Log request start
  logger.info('Request started', {
    requestId,
    method: request.method,
    url: request.url,
    userAgent: request.headers['user-agent'],
    contentLength: request.headers['content-length'],
  });
}

/**
 * Response logging hook.
 * Logs response completion with timing, status, and usage metrics.
 */
export async function responseLoggerMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = request.id;
  const duration = request.startTime ? Date.now() - request.startTime : 0;

  const logData: Record<string, unknown> = {
    requestId,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: duration,
    contentLength: reply.getHeader('content-length'),
  };

  // Include provider metrics if available
  if (request.providerMetrics) {
    logData.provider = {
      planId: request.providerMetrics.planId,
      planName: request.providerMetrics.planName,
      model: request.providerMetrics.model,
      durationMs: request.providerMetrics.durationMs,
      statusCode: request.providerMetrics.statusCode,
    };

    // Include token usage if available
    if (request.providerMetrics.tokenUsage) {
      logData.tokens = {
        input: request.providerMetrics.tokenUsage.inputTokens,
        output: request.providerMetrics.tokenUsage.outputTokens,
        total: request.providerMetrics.tokenUsage.totalTokens,
      };
    }

    // Include provider response time if available
    if (request.providerMetrics.providerResponseTimeMs) {
      logData.providerResponseTimeMs = request.providerMetrics.providerResponseTimeMs;
    }
  }

  logger.info('Request completed', logData);
}

/**
 * Error logging hook.
 * Logs errors that occur during request processing.
 */
export function errorLoggerMiddleware(
  error: Error,
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const requestId = request.id;
  const duration = request.startTime ? Date.now() - request.startTime : 0;

  const logData: Record<string, unknown> = {
    requestId,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: duration,
  };

  // Include provider metrics if available
  if (request.providerMetrics) {
    logData.provider = {
      planId: request.providerMetrics.planId,
      planName: request.providerMetrics.planName,
      model: request.providerMetrics.model,
    };
  }

  logger.error('Request failed', error, logData);

  done();
}

/**
 * Attach provider metrics to the request for logging.
 * Call this from handlers after a request is processed.
 *
 * @param request - The Fastify request object
 * @param metrics - Provider metrics to attach
 */
export function attachProviderMetrics(
  request: FastifyRequest,
  metrics: ProviderMetrics
): void {
  request.providerMetrics = metrics;
}

/**
 * Extract token usage from OpenAI response.
 */
export function extractOpenAITokenUsage(
  response: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
): TokenUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  return {
    inputTokens: response.usage.prompt_tokens ?? 0,
    outputTokens: response.usage.completion_tokens ?? 0,
    totalTokens: response.usage.total_tokens ?? 0,
  };
}

/**
 * Extract token usage from Anthropic response.
 */
export function extractAnthropicTokenUsage(
  response: { usage?: { input_tokens?: number; output_tokens?: number } }
): TokenUsage | undefined {
  if (!response.usage) {
    return undefined;
  }

  const inputTokens = response.usage.input_tokens ?? 0;
  const outputTokens = response.usage.output_tokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Register request logging hooks with a Fastify instance.
 */
export function registerRequestLogger(app: FastifyInstance): void {
  // Log request start
  app.addHook('onRequest', requestLoggerMiddleware);

  // Log response completion
  app.addHook('onResponse', responseLoggerMiddleware);
}

// Import FastifyInstance for type annotation
import { FastifyInstance } from 'fastify';
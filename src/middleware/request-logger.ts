/**
 * Request logging middleware.
 * Logs all incoming requests and their responses with detailed metrics.
 *
 * @module middleware/request-logger
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction, FastifyInstance } from 'fastify';
import { logger, createRequestLogger } from '@/utils/logger';
import type { UsageTracker } from '@/services/usage-tracker';

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
  planId: number;
  planName: string;
  /** Original model name requested by user */
  model: string;
  /** Canonical model name after alias resolution (set when model !== canonicalModel) */
  canonicalModel?: string;
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
    /** True once a hijacked streaming responder has logged completion.
     *  Prevents duplicate "Request completed" logs when the raw response's
     *  finish event also fires the onResponse hook. */
    streamingResponseLogged?: boolean;
  }
}

/**
 * Auth context interface (imported from auth middleware).
 */
interface AuthContext {
  apiKey: {
    id: string;
    name: string;
    prefix: string;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Request logging middleware.
 * Logs request start and end with timing information.
 */
export function requestLoggerMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): void {
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
 * Build the log data object for a completed request.
 * Extracted so hijacked streaming responses can log completion manually.
 */
function buildResponseLogData(
  request: FastifyRequest,
  reply: FastifyReply
): Record<string, unknown> {
  const duration = request.startTime ? Date.now() - request.startTime : 0;

  const logData: Record<string, unknown> = {
    requestId: request.id,
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
      canonicalModel: request.providerMetrics.canonicalModel,
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

  return logData;
}

/**
 * Log a streaming response completion without the onResponse hook.
 *
 * Hijacked streaming responders call this after the stream ends so that a
 * "Request completed" log is emitted even when the client disconnects
 * mid-stream (in which case the raw response's `finish` event never fires
 * and the onResponse hook never runs).  Idempotent: subsequent calls (e.g.
 * from the onResponse hook on a normal completion) are no-ops, and token
 * usage recording is still performed by responseLoggerMiddleware.
 */
export function logStreamingResponse(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (request.streamingResponseLogged) {
    return;
  }
  request.streamingResponseLogged = true;
  const logData = buildResponseLogData(request, reply);
  logger.info('Request completed', logData);
}

/**
 * Response logging hook.
 * Logs response completion with timing, status, and usage metrics.
 * Records token usage to UsageTracker if available.
 *
 * For hijacked streaming responses, logStreamingResponse() has already
 * emitted the log line; here we only record token usage (which requires
 * the app-level UsageTracker not available to the streaming responder).
 */
export function responseLoggerMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  usageTracker?: UsageTracker
): void {
  // Record token usage to UsageTracker if request was authenticated.
  // Done even for hijacked streaming responses (where the log line was
  // already emitted by logStreamingResponse) so usage stats stay accurate.
  if (usageTracker && request.auth && request.providerMetrics?.tokenUsage) {
    usageTracker.recordTokenUsage(
      request.auth.apiKey.id,
      request.providerMetrics.tokenUsage.inputTokens,
      request.providerMetrics.tokenUsage.outputTokens
    );
  }

  // Streaming responder already logged completion — skip duplicate log line.
  if (request.streamingResponseLogged) {
    return;
  }
  // Mark as logged so a late manual logStreamingResponse() call (which runs
  // in a Promise microtask after this nextTick-fired onResponse hook) skips.
  request.streamingResponseLogged = true;

  const logData = buildResponseLogData(request, reply);
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
 * Preserves existing canonicalModel if new metrics don't include it.
 *
 * @param request - The Fastify request object
 * @param metrics - Provider metrics to attach
 */
export function attachProviderMetrics(
  request: FastifyRequest,
  metrics: ProviderMetrics
): void {
  // Preserve existing canonicalModel if new metrics don't include it
  if (request.providerMetrics?.canonicalModel && !metrics.canonicalModel) {
    request.providerMetrics = { ...metrics, canonicalModel: request.providerMetrics.canonicalModel };
  } else {
    request.providerMetrics = metrics;
  }
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
 *
 * Sets up hooks that log all incoming requests and their responses with
 * timing information, status codes, and provider metrics. This should be
 * called during application initialization.
 *
 * @param app - The Fastify instance to register the logging hooks with
 * @param usageTracker - Optional UsageTracker for recording token usage
 *
 * @example
 * ```typescript
 * const app = Fastify();
 * registerRequestLogger(app, usageTracker);
 * ```
 */
export function registerRequestLogger(
  app: FastifyInstance,
  usageTracker?: UsageTracker
): void {
  // Log request start - using middleware style with done callback
  app.addHook('onRequest', (request: FastifyRequest, _reply: FastifyReply, done: HookHandlerDoneFunction) => {
    requestLoggerMiddleware(request, _reply);
    done();
  });

  // Log response completion
  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    responseLoggerMiddleware(request, reply, usageTracker);
    done();
  });
}
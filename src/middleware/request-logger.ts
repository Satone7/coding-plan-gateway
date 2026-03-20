/**
 * Request logging middleware.
 * Logs all incoming requests and their responses.
 */

import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { logger, createRequestLogger } from '@/utils/logger';

/**
 * Request context attached to request object.
 */
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    requestLogger?: ReturnType<typeof createRequestLogger>;
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
 * Logs response completion with timing and status.
 */
export async function responseLoggerMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = request.id;
  const duration = request.startTime ? Date.now() - request.startTime : 0;

  logger.info('Request completed', {
    requestId,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: duration,
    contentLength: reply.getHeader('content-length'),
  });
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

  logger.error('Request failed', error, {
    requestId,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    durationMs: duration,
  });

  done();
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
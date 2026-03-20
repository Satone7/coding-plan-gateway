/**
 * Global error handler middleware.
 * Catches all errors and returns consistent error responses.
 */

import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { GatewayError, GatewayErrorCode } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Error response structure.
 */
interface ErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
    details?: Record<string, unknown>;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * Map HTTP status codes to gateway error codes.
 */
function getErrorCode(statusCode: number): GatewayErrorCode {
  switch (statusCode) {
    case 400:
      return 'INVALID_REQUEST';
    case 404:
      return 'MODEL_NOT_FOUND';
    case 429:
      return 'QUOTA_EXHAUSTED';
    case 502:
      return 'UPSTREAM_ERROR';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'UPSTREAM_TIMEOUT';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Format Zod validation errors.
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'root';
    if (!result[path]) {
      result[path] = [];
    }
    result[path].push(issue.message);
  }

  return result;
}

/**
 * Global error handler.
 * Must be registered as a Fastify error handler.
 */
// eslint-disable-next-line max-lines-per-function
export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;
  const timestamp = new Date().toISOString();

  // Log the error
  logger.error('Request error', error, {
    requestId,
    method: request.method,
    url: request.url,
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const response: ErrorResponse = {
      error: {
        message: 'Validation failed',
        type: 'validation_error',
        code: 'INVALID_REQUEST',
        details: { validationErrors: formatZodErrors(error) },
      },
      meta: { requestId, timestamp },
    };

    void reply.status(400).send(response);
    return;
  }

  // Handle gateway errors
  if ('code' in error && typeof error.code === 'string' && 'type' in error && typeof error.type === 'string') {
    const gatewayError = error as unknown as GatewayError;
    const statusCode = getStatusCodeForErrorCode(gatewayError.code);

    const response: ErrorResponse = {
      error: {
        message: gatewayError.message,
        type: gatewayError.type,
        code: gatewayError.code,
        details: gatewayError.details,
      },
      meta: { requestId, timestamp },
    };

    void reply.status(statusCode).send(response);
    return;
  }

  // Handle Fastify errors with status codes
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    const fastifyError = error as FastifyError;
    const statusCode = fastifyError.statusCode ?? 500;

    const response: ErrorResponse = {
      error: {
        message: fastifyError.message || 'Request failed',
        type: 'request_error',
        code: getErrorCode(statusCode),
      },
      meta: { requestId, timestamp },
    };

    void reply.status(statusCode).send(response);
    return;
  }

  // Handle unknown errors
  const response: ErrorResponse = {
    error: {
      message: 'Internal server error',
      type: 'internal_error',
      code: 'INTERNAL_ERROR',
    },
    meta: { requestId, timestamp },
  };

  void reply.status(500).send(response);
}

/**
 * Get HTTP status code for error code.
 */
function getStatusCodeForErrorCode(code: GatewayErrorCode): number {
  switch (code) {
    case 'INVALID_REQUEST':
      return 400;
    case 'MODEL_NOT_FOUND':
    case 'PLAN_NOT_FOUND':
      return 404;
    case 'QUOTA_EXHAUSTED':
      return 429;
    case 'UPSTREAM_ERROR':
      return 502;
    case 'UPSTREAM_TIMEOUT':
      return 504;
    case 'SERVICE_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}

/**
 * Register the error handler with a Fastify instance.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(errorHandler);
}

// Import FastifyInstance for type annotation
import { FastifyInstance } from 'fastify';
/**
 * Authentication middleware.
 * Validates API keys on incoming requests and provides exemption handling.
 *
 * @module middleware/auth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApiKeyManager } from '@/services/api-key-manager';
import { loadAuthConfig, parseExemptPaths, isExemptPath } from '@/config/auth-config';
import { logger } from '@/utils/logger';
import type { AuthConfig } from '@/config/schema';

/**
 * Authentication error response structure.
 */
interface AuthErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

/**
 * Request authentication context.
 */
export interface AuthContext {
  /** The authenticated API key */
  apiKey: {
    id: string;
    name: string;
    prefix: string;
  };
}

/**
 * Augment FastifyRequest with auth context.
 */
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Auth middleware options.
 */
export interface AuthMiddlewareOptions {
  /** ApiKeyManager instance */
  apiKeyManager: ApiKeyManager;
  /** Auth configuration (optional, will load from env if not provided) */
  config?: AuthConfig;
}

/**
 * Create a 401 Unauthorized error response.
 *
 * @param requestId - The request ID
 * @param message - Error message
 * @returns The error response
 */
function createUnauthorizedResponse(requestId: string, message: string): AuthErrorResponse {
  return {
    error: {
      message,
      type: 'authentication_error',
      code: 'UNAUTHORIZED',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Create a 403 Forbidden error response.
 *
 * @param requestId - The request ID
 * @param message - Error message
 * @returns The error response
 */
function createForbiddenResponse(requestId: string, message: string): AuthErrorResponse {
  return {
    error: {
      message,
      type: 'permission_error',
      code: 'FORBIDDEN',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Extract Bearer token from Authorization header.
 *
 * @param authHeader - The Authorization header value
 * @returns The token or null if not found/invalid format
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return null;
  }

  const token = parts[1];
  return token && token.length > 0 ? token : null;
}

/**
 * Create the authentication preHandler hook.
 *
 * @param options - Auth middleware options
 * @returns The preHandler hook function
 */
function createAuthHook(options: AuthMiddlewareOptions) {
  const { apiKeyManager, config } = options;
  const authConfig = config ?? loadAuthConfig();
  const exemptPaths = parseExemptPaths(authConfig.authExemptPaths);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const requestId = request.id;
    const path = request.url;

    // Check if path is exempt from authentication
    if (isExemptPath(path, exemptPaths)) {
      logger.debug('Path is exempt from authentication', { path, requestId });
      return;
    }

    // Extract Authorization header
    const authHeader = request.headers.authorization;
    const token = extractBearerToken(authHeader);

    if (!token) {
      logger.debug('Missing or invalid Authorization header', { requestId, path });
      const response = createUnauthorizedResponse(requestId, 'Missing or invalid Authorization header');
      return reply.status(401).send(response);
    }

    // Validate the API key with detailed status
    const validationResult = await apiKeyManager.validateKeyWithStatus(token);

    if (!validationResult.valid) {
      // Handle different failure reasons
      if (validationResult.status === 'disabled') {
        logger.debug('API key is disabled', { requestId, path, keyId: validationResult.key?.id });
        const response = createForbiddenResponse(requestId, 'API key is disabled');
        return reply.status(403).send(response);
      }

      if (validationResult.status === 'expired') {
        logger.debug('API key has expired', { requestId, path, keyId: validationResult.key?.id });
        const response = createUnauthorizedResponse(requestId, 'API key has expired');
        return reply.status(401).send(response);
      }

      // Invalid key
      logger.debug('Invalid API key', { requestId, path });
      const response = createUnauthorizedResponse(requestId, 'Invalid API key');
      return reply.status(401).send(response);
    }

    const apiKey = validationResult.key!;

    // Attach auth context to request
    request.auth = {
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.prefix,
      },
    };

    logger.debug('Request authenticated', {
      requestId,
      path,
      keyId: apiKey.id,
      keyName: apiKey.name,
    });
  };
}

/**
 * Register authentication middleware with a Fastify instance.
 *
 * @param app - The Fastify instance
 * @param options - Auth middleware options
 *
 * @example
 * ```typescript
 * const app = Fastify();
 * const apiKeyManager = createApiKeyManager();
 * await apiKeyManager.initialize();
 *
 * registerAuthMiddleware(app, { apiKeyManager });
 * ```
 */
export function registerAuthMiddleware(
  app: FastifyInstance,
  options: AuthMiddlewareOptions
): void {
  const authHook = createAuthHook(options);

  // Register as preHandler hook (runs before route handlers)
  app.addHook('preHandler', authHook);

  logger.info('Authentication middleware registered');
}

/**
 * Check if a request is authenticated.
 *
 * @param request - The Fastify request
 * @returns True if the request has valid auth context
 */
export function isAuthenticated(request: FastifyRequest): boolean {
  return request.auth !== undefined;
}

/**
 * Get the auth context from a request.
 *
 * @param request - The Fastify request
 * @returns The auth context or undefined if not authenticated
 */
export function getAuthContext(request: FastifyRequest): AuthContext | undefined {
  return request.auth;
}
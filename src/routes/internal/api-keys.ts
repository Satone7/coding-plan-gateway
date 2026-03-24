/**
 * Internal API key routes.
 * Provides programmatic access to API key management.
 * These routes are for internal/admin use and may require separate authentication.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { ApiKey } from '@/types';

/**
 * Options for internal API key routes.
 */
export interface InternalApiKeyRoutesOptions {
  /** ApiKeyManager instance */
  apiKeyManager: ApiKeyManager;
  /** API prefix (default: '/internal') */
  prefix?: string;
}

/**
 * API key summary for list responses (excludes sensitive data).
 */
interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Convert ApiKey to summary format.
 */
function toSummary(key: ApiKey): ApiKeySummary {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    status: key.status,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt?.toISOString() ?? null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  };
}

// Request schemas
const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

/**
 * Create handlers for API key routes.
 */
function createHandlers(apiKeyManager: ApiKeyManager) {
  return {
    /**
     * List all API keys.
     * GET /internal/keys
     */
    async listKeys(
      request: FastifyRequest,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      const keys = apiKeyManager.getAllKeys();
      const summaries = keys.map(toSummary);

      return reply.send({
        keys: summaries,
      });
    },

    /**
     * Create a new API key.
     * POST /internal/keys
     */
    async createKey(
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      // Validate request body
      const parseResult = createKeySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            message: 'Invalid request body',
            type: 'validation_error',
            details: parseResult.error.errors,
          },
        });
      }

      const { name, expiresAt } = parseResult.data;

      // Create the key
      const { plaintextKey, key } = await apiKeyManager.createKey({
        name,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      });

      return reply.code(201).send({
        id: key.id,
        name: key.name,
        key: plaintextKey,
        prefix: key.prefix,
        createdAt: key.createdAt.toISOString(),
      });
    },

    /**
     * Get a specific API key by ID.
     * GET /internal/keys/:keyId
     */
    async getKey(
      request: FastifyRequest<{ Params: { keyId: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      const { keyId } = request.params;
      const key = apiKeyManager.getKeyById(keyId);

      if (!key) {
        return reply.code(404).send({
          error: {
            message: 'API key not found',
            type: 'not_found_error',
            code: 'api_key_not_found',
          },
        });
      }

      return reply.send(toSummary(key));
    },

    /**
     * Update key status.
     * PATCH /internal/keys/:keyId/status
     */
    async updateKeyStatus(
      request: FastifyRequest<{ Params: { keyId: string }; Body: unknown }>,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      const { keyId } = request.params;

      // Validate request body
      const parseResult = updateStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            message: 'Invalid request body',
            type: 'validation_error',
            details: parseResult.error.errors,
          },
        });
      }

      const { status } = parseResult.data;

      // Check if key exists
      const key = apiKeyManager.getKeyById(keyId);
      if (!key) {
        return reply.code(404).send({
          error: {
            message: 'API key not found',
            type: 'not_found_error',
            code: 'api_key_not_found',
          },
        });
      }

      // Update status
      await apiKeyManager.updateKeyStatus(keyId, status);
      const updatedKey = apiKeyManager.getKeyById(keyId);

      return reply.send(toSummary(updatedKey!));
    },

    /**
     * Delete an API key.
     * DELETE /internal/keys/:keyId
     */
    async deleteKey(
      request: FastifyRequest<{ Params: { keyId: string } }>,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      const { keyId } = request.params;

      // Check if key exists
      const key = apiKeyManager.getKeyById(keyId);
      if (!key) {
        return reply.code(404).send({
          error: {
            message: 'API key not found',
            type: 'not_found_error',
            code: 'api_key_not_found',
          },
        });
      }

      // Delete the key
      await apiKeyManager.deleteKey(keyId);

      return reply.code(204).send();
    },
  };
}

/**
 * Register internal API key routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options
 */
export async function registerInternalApiKeyRoutes(
  app: FastifyInstance,
  options: InternalApiKeyRoutesOptions
): Promise<void> {
  const { apiKeyManager, prefix = '/internal' } = options;
  const handlers = createHandlers(apiKeyManager);

  await app.register(
    (fastify, _options, done) => {
      // GET /internal/keys - List all keys
      fastify.get('/keys', handlers.listKeys);

      // POST /internal/keys - Create a new key
      fastify.post('/keys', handlers.createKey);

      // GET /internal/keys/:keyId - Get a specific key
      fastify.get('/keys/:keyId', handlers.getKey);

      // PATCH /internal/keys/:keyId/status - Update key status
      fastify.patch('/keys/:keyId/status', handlers.updateKeyStatus);

      // DELETE /internal/keys/:keyId - Delete a key
      fastify.delete('/keys/:keyId', handlers.deleteKey);

      done();
    },
    { prefix }
  );
}
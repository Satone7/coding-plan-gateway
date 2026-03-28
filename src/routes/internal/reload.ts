/**
 * Internal reload endpoint.
 * Allows CLI to notify the gateway to refresh its in-memory state.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { UsageTracker } from '@/services/usage-tracker';
import { logger } from '@/utils/logger';
import { reloadModelAliases } from '@/config';

/**
 * Options for reload routes.
 */
export interface ReloadRoutesOptions {
  /** ApiKeyManager instance */
  apiKeyManager: ApiKeyManager;
  /** UsageTracker instance */
  usageTracker?: UsageTracker;
  /** API prefix (default: '/internal') */
  prefix?: string;
}

/**
 * Types of data that can be reloaded.
 */
type ReloadType = 'api-keys' | 'usage' | 'config' | 'all';

// Request schema
const reloadSchema = z.object({
  type: z.enum(['api-keys', 'usage', 'config', 'all']).default('all'),
});

/**
 * Reload response.
 */
interface ReloadResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

/**
 * Create handlers for reload routes.
 */
function createHandlers(
  apiKeyManager: ApiKeyManager,
  usageTracker?: UsageTracker
): {
  reload: (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => Promise<FastifyReply>;
} {
  return {
    /**
     * Reload gateway data from storage.
     * POST /internal/reload
     */
    async reload(
      request: FastifyRequest<{ Body: unknown }>,
      reply: FastifyReply
    ): Promise<FastifyReply> {
      // Validate request body
      const parseResult = reloadSchema.safeParse(request.body ?? {});
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid request body',
          timestamp: new Date().toISOString(),
        } as ReloadResponse);
      }

      const { type } = parseResult.data;
      const timestamp = new Date().toISOString();

      try {
        let reloaded: string[] = [];

        if (type === 'api-keys' || type === 'all') {
          await apiKeyManager.initialize();
          reloaded.push('api-keys');
          logger.info('API keys reloaded', { keyCount: apiKeyManager.getAllKeys().length });
        }

        if (type === 'usage' || type === 'all') {
          if (usageTracker) {
            await usageTracker.initialize();
            reloaded.push('usage');
            logger.info('Usage data reloaded');
          }
        }

        if (type === 'config' || type === 'all') {
          const reloadedAliases = await reloadModelAliases();
          if (reloadedAliases) {
            reloaded.push('model-aliases');
          }
        }

        return reply.send({
          success: true,
          message: `Reloaded: ${reloaded.join(', ')}`,
          timestamp,
        } as ReloadResponse);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to reload data', error instanceof Error ? error : undefined, { type });

        return reply.code(500).send({
          success: false,
          message: `Failed to reload: ${errorMessage}`,
          timestamp,
        } as ReloadResponse);
      }
    },
  };
}

/**
 * Register reload routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options
 */
export async function registerReloadRoutes(
  app: FastifyInstance,
  options: ReloadRoutesOptions
): Promise<void> {
  const { apiKeyManager, usageTracker, prefix = '/internal' } = options;
  const handlers = createHandlers(apiKeyManager, usageTracker);

  await app.register(
    (fastify, _options, done) => {
      // POST /internal/reload - Reload data from storage
      fastify.post('/reload', handlers.reload);

      done();
    },
    { prefix }
  );
}
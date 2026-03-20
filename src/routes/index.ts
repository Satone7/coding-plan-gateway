/**
 * Route registration aggregator.
 * Registers all routes with the Fastify instance.
 */

import { FastifyInstance } from 'fastify';
import { logger } from '@/utils/logger';

/**
 * Route plugin function type.
 */
type RoutePlugin = (app: FastifyInstance) => Promise<void> | void;

/**
 * Registered route plugins.
 * Add new route modules here as they are implemented.
 */
const routePlugins: Array<{ name: string; plugin: RoutePlugin }> = [];

/**
 * Register a route plugin.
 * Route plugins should be added here during implementation.
 */
export function registerRoutePlugin(name: string, plugin: RoutePlugin): void {
  routePlugins.push({ name, plugin });
}

/**
 * Register all routes with the Fastify instance.
 *
 * @param app - The Fastify instance
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  logger.info('Registering routes...');

  // Register health endpoints (basic implementation for now)
  await app.register(async (fastify) => {
    fastify.get('/health', async () => ({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
    }));

    fastify.get('/ready', async () => ({
      ready: true,
      plans: 0,
      models: 0,
      checks: {
        config: true,
        quotaStore: true,
      },
    }));
  });

  // Register all route plugins
  for (const { name, plugin } of routePlugins) {
    try {
      await plugin(app);
      logger.debug(`Registered route plugin: ${name}`);
    } catch (error) {
      logger.error(`Failed to register route plugin: ${name}`, error as Error);
      throw error;
    }
  }

  logger.info(`Registered ${routePlugins.length} route plugin(s)`);
}

/**
 * Root route handler for basic health check.
 */
export async function rootHandler(): Promise<{ status: string; version: string }> {
  return {
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
  };
}
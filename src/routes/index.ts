/**
 * Route registration aggregator.
 * Registers all routes with the Fastify instance.
 */

import { FastifyInstance } from 'fastify';
import { logger } from '@/utils/logger';
import { registerOpenAIRoutes } from './openai';
import { registerAnthropicRoutes } from './anthropic';
import { registerAdminRoutes } from './admin';
import { createPlanRepository } from '@/services/plan-repository';
import { createQuotaManager } from '@/services/quota-manager';
import { createRequestProxy } from '@/services/request-proxy';

/**
 * Register all routes with the Fastify instance.
 *
 * @param app - The Fastify instance
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  logger.info('Registering routes...');

  // Register health endpoints
  app.get('/health', () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  }));

  app.get('/ready', () => ({
    ready: true,
    plans: 0,
    models: 0,
    checks: {
      config: true,
      quotaStore: true,
    },
  }));

  // Create dependencies
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const configPath = process.env.CONFIG_PATH ?? './config.yaml';
  const repository = createPlanRepository(configPath, encryptionKey);
  const proxy = createRequestProxy();

  // Create quota manager if encryption key is available
  const quotaManager = encryptionKey ? createQuotaManager() : undefined;

  // Register API routes
  await registerOpenAIRoutes(app, {
    repository,
    proxy,
    prefix: '/v1',
  });

  await registerAnthropicRoutes(app, {
    repository,
    proxy,
    prefix: '/v1',
  });

  await registerAdminRoutes(app, {
    repository,
    quotaManager,
    prefix: '/api',
  });

  logger.info('All routes registered');
}
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
import { createPlanIdCounter } from '@/services/plan-id-counter';
import type { QuotaManager } from '@/services/quota-manager';
import { createRequestProxy } from '@/services/request-proxy';
import { dirname, join } from 'path';

/**
 * Register all routes with the Fastify instance.
 *
 * @param app - The Fastify instance
 * @param quotaManager - Optional quota manager instance (must be initialized by caller)
 */
export async function registerRoutes(
  app: FastifyInstance,
  quotaManager?: QuotaManager
): Promise<void> {
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

  // Create and initialize PlanIdCounter
  const configDir = dirname(configPath);
  const counterPath = join(configDir, 'plan-id-counter.json');
  const planIdCounter = createPlanIdCounter({ counterPath });
  await planIdCounter.initialize();

  // Connect counter to repository
  repository.setPlanIdCounter(planIdCounter);

  const proxy = createRequestProxy();

  // Register API routes
  await registerOpenAIRoutes(app, {
    repository,
    proxy,
    quotaManager,
    prefix: '/v1',
  });

  await registerAnthropicRoutes(app, {
    repository,
    proxy,
    quotaManager,
    prefix: '/v1',
  });

  await registerAdminRoutes(app, {
    repository,
    quotaManager,
    prefix: '/api',
  });

  logger.info('All routes registered');
}
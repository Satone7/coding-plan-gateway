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
import { isMigrationNeeded, performMigration } from '@/migration/uuid-to-int';
import type { QuotaManager } from '@/services/quota-manager';
import type { PlanUsageTracker } from '@/services/plan-usage-tracker';
import { createRequestProxy } from '@/services/request-proxy';
import { dirname, join } from 'path';
import { loadConfig } from '@/config';

/**
 * Register all routes with the Fastify instance.
 *
 * @param app - The Fastify instance
 * @param quotaManager - Optional quota manager instance (must be initialized by caller)
 * @param planUsageTracker - Optional plan usage tracker instance
 */
export async function registerRoutes(
  app: FastifyInstance,
  quotaManager?: QuotaManager,
  planUsageTracker?: PlanUsageTracker
): Promise<void> {
  logger.info('Registering routes...');

  // Create dependencies
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const configPath = process.env.CONFIG_PATH ?? './config.yaml';
  const repository = createPlanRepository(configPath, encryptionKey);

  // Register health endpoints
  app.get('/health', () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  }));

  // Load config to get plan count for readiness check
  const config = await loadConfig(configPath, encryptionKey);
  const planCount = config.plans.length;
  const modelSet = new Set<string>();
  for (const plan of config.plans) {
    for (const model of plan.models) {
      modelSet.add(model);
    }
  }

  app.get('/ready', () => ({
    ready: true,
    plans: planCount,
    models: modelSet.size,
    checks: {
      config: true,
      quotaStore: quotaManager !== undefined,
    },
  }));

  // Create and initialize PlanIdCounter
  const configDir = dirname(configPath);
  const counterPath = join(configDir, 'plan-id-counter.json');
  const migrationLogPath = join(configDir, 'migration-log.json');
  const quotaStatePath = process.env.QUOTA_STATE_PATH ?? join(configDir, 'quota-state.json');
  const planIdCounter = createPlanIdCounter({ counterPath });
  await planIdCounter.initialize();

  // Check if migration is needed and perform it
  if (!planIdCounter.isMigrationComplete()) {
    const needsMigration = await isMigrationNeeded(configPath);
    if (needsMigration) {
      logger.info('UUID-based plan IDs detected, starting migration...');
      try {
        const result = await performMigration({
          configPath,
          quotaStatePath,
          planIdCounter,
          migrationLogPath,
        });
        if (result.migrated) {
          logger.info('Migration completed successfully', {
            planCount: result.planCount,
            migrationLogPath,
          });
        }
      } catch (error) {
        logger.error('Migration failed', error as Error);
        throw error;
      }
    }
  }

  // Connect counter to repository
  repository.setPlanIdCounter(planIdCounter);

  const proxy = createRequestProxy();

  // Register API routes under /api prefix
  await registerOpenAIRoutes(app, {
    repository,
    proxy,
    quotaManager,
    prefix: '/api/v1',
  });

  await registerAnthropicRoutes(app, {
    repository,
    proxy,
    quotaManager,
    prefix: '/api/v1',
  });

  await registerAdminRoutes(app, {
    repository,
    quotaManager,
    planUsageTracker,
    prefix: '/api/admin',
  });

  logger.info('All routes registered');
}
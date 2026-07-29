/**
 * Route registration aggregator.
 * Registers all routes with the Fastify instance.
 */

import { FastifyInstance } from 'fastify';
import { logger } from '@/utils/logger';
import { registerOpenAIRoutes } from './openai';
import { registerAnthropicRoutes } from './anthropic';
import { registerAdminRoutes } from './admin';
import { registerWebDashboardRoutes } from './web-dashboard';
import { createPlanRepository, type IPlanRepository } from '@/services/plan-repository';
import { createPlanIdCounter } from '@/services/plan-id-counter';
import { isMigrationNeeded, performMigration } from '@/migration/uuid-to-int';
import type { QuotaManager } from '@/services/quota-manager';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { PlanUsageTracker } from '@/services/plan-usage-tracker';
import type { ProviderRegistry } from '@/services/provider-registry';
import { createRequestProxy } from '@/services/request-proxy';
import { createModelSyncService, type ModelSyncService } from '@/services/model-sync-service';
import { dirname, join } from 'path';
import { loadConfig, buildCustomProvidersMap } from '@/config';

/**
 * Register all routes with the Fastify instance.
 *
 * @param app - The Fastify instance
 * @param quotaManager - Optional quota manager instance (must be initialized by caller)
 * @param planUsageTracker - Optional plan usage tracker instance
 * @returns Object containing the created repository
 */
export async function registerRoutes(
  app: FastifyInstance,
  quotaManager?: QuotaManager,
  planUsageTracker?: PlanUsageTracker,
  providerRegistry?: ProviderRegistry,
  apiKeyManager?: ApiKeyManager
): Promise<{ repository: IPlanRepository; modelSyncService: ModelSyncService }> {
  logger.info('Registering routes...');

  // Create dependencies
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const configPath = process.env.CONFIG_PATH ?? './config.yaml';

  // Load config once: customProviders feed repository normalization; planCount feeds /ready
  const config = await loadConfig(configPath, encryptionKey);
  const customProviders = buildCustomProvidersMap(config.providers);
  const repository = createPlanRepository(configPath, encryptionKey, customProviders);

  // Register health endpoints
  app.get('/health', () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
  }));

  const planCount = config.plans.length;
  const modelSet = new Set<string>();
  for (const plan of config.plans) {
    for (const model of plan.models) {
      modelSet.add(model);
    }
    if (plan.modelAliases) {
      for (const [alias, target] of Object.entries(plan.modelAliases)) {
        if (plan.models.some((m) => m.toLowerCase() === target.toLowerCase())) {
          modelSet.add(alias);
        }
      }
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

  // Dynamic model sync for dynamicModels plans (e.g. local LM Studio providers).
  // Updates models in memory only; never persists. Runs once now, then on an interval.
  const modelSyncService = createModelSyncService({
    repository,
    defaultIntervalMs: process.env.MODEL_SYNC_INTERVAL_MS
      ? parseInt(process.env.MODEL_SYNC_INTERVAL_MS, 10)
      : undefined,
  });
  await modelSyncService.syncAll().catch((err) => {
    logger.warn('Initial dynamic model sync failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  modelSyncService.start();

  const proxy = createRequestProxy();

  // Register API routes under /api prefix
  await registerOpenAIRoutes(app, {
    repository,
    proxy,
    quotaManager,
    providerRegistry,
    loadBalanceConfig: config.loadBalancing,
    modelRoutingConfig: config.modelRouting,
    prefix: '/api/v1',
  });

  await registerAnthropicRoutes(app, {
    repository,
    proxy,
    quotaManager,
    providerRegistry,
    loadBalanceConfig: config.loadBalancing,
    modelRoutingConfig: config.modelRouting,
    prefix: '/api/v1',
  });

  await registerAdminRoutes(app, {
    repository,
    quotaManager,
    planUsageTracker,
    providerRegistry,
    apiKeyManager,
    prefix: '/api/admin',
  });

  // Read-only web monitoring dashboard (HTML page + JSON metric endpoints)
  registerWebDashboardRoutes(app);

  logger.info('All routes registered');

  return { repository, modelSyncService };
}
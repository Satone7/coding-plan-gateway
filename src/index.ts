/**
 * Application entry point.
 * Creates and starts the Fastify server.
 */

// Load environment variables from .env file (must be first import)
import 'dotenv/config';

import { createApp, startServer } from './app';
import { logger, addLogListener } from './utils/logger';
import { ipcServer } from './utils/ipc-server';
import { dashboardMetrics } from './utils/dashboard-metrics';
import { loadConfig } from './config';
import { createQuotaManager } from './services/quota-manager';
import { createApiKeyManager } from './services/api-key-manager';
import { createUsageTracker } from './services/usage-tracker';
import { createPlanUsageTracker } from './services/plan-usage-tracker';
import { createExpirationScheduler } from './services/expiration-scheduler';
import { createPlanRepository } from './services/plan-repository';
import { createProviderRegistry } from './services/provider-registry';
import { ZhipuUsageAdapter } from './services/usage-adapters/zhipu-adapter';
import { CachedUsageAdapter } from './services/usage-adapters/cached-adapter';
import { loadAuthConfig } from './config/auth-config';
import { decryptApiKey, isApiKeyEncrypted } from './config/encryption';
import { loadPlanUsageConfig } from './config/defaults';

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  try {
    // Validate environment variables
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }

    if (encryptionKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(encryptionKey)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
    }

    // Load configuration
    const configPath = process.env.CONFIG_PATH ?? './config.yaml';
    const config = await loadConfig(configPath, encryptionKey, { autoUpgrade: true });

    // Create and initialize provider registry with usage adapters
    const providerRegistry = createProviderRegistry(config.providers);
    providerRegistry.registerUsageAdapter(
      new CachedUsageAdapter(new ZhipuUsageAdapter(), 300)
    );

    // Create and initialize quota manager
    const quotaManager = createQuotaManager({
      quotaStatePath: process.env.QUOTA_STATE_PATH,
      syncIntervalMs: process.env.QUOTA_SYNC_INTERVAL
        ? parseInt(process.env.QUOTA_SYNC_INTERVAL, 10)
        : undefined,
      providerRegistry,
    });
    // Filter plans to only include those with numeric IDs (UUID IDs need migration first)
    const plansWithNumericIds = config.plans.filter(
      (plan): plan is typeof plan & { id: number } => typeof plan.id === 'number'
    );
    await quotaManager.initialize(plansWithNumericIds);
    quotaManager.startPeriodicSync();

    // Create and initialize plan usage tracker
    const planUsageConfig = loadPlanUsageConfig();
    const planUsageTracker = createPlanUsageTracker({
      planUsageDataPath: planUsageConfig.planUsageDataPath,
      adjustmentHistoryPath: planUsageConfig.adjustmentHistoryPath,
    });
    await planUsageTracker.initialize();
    planUsageTracker.startPeriodicSync();

    // Connect plan usage tracker to quota manager
    quotaManager.setPlanUsageTracker(planUsageTracker);

    // Create plan repository for expiration scheduler
    const planRepository = createPlanRepository(configPath, encryptionKey);
    await planRepository.reload();

    // Create and start expiration scheduler
    const expirationScheduler = createExpirationScheduler(
      planUsageTracker,
      planRepository,
      { checkIntervalMs: 60000 }, // Check every minute
      quotaManager
    );
    expirationScheduler.start();

    // Create and initialize API key manager
    const authConfig = loadAuthConfig();
    const apiKeyManager = createApiKeyManager({
      apiKeysPath: authConfig.apiKeysPath,
    });
    await apiKeyManager.initialize();

    // Create and initialize usage tracker
    const usageTracker = createUsageTracker({
      usageDataPath: authConfig.usageDataPath,
      syncIntervalMs: authConfig.usageSyncIntervalMs,
    });
    await usageTracker.initialize();
    usageTracker.startPeriodicSync();

    // Start IPC server
    try {
      await ipcServer.start();
      addLogListener((entry) => {
        dashboardMetrics.processEntry(entry);
        ipcServer.broadcast(entry);
      });
      ipcServer.onConnect((socket) => {
        ipcServer.sendToClient(socket, { type: 'snapshot', data: dashboardMetrics.getSnapshot() });
      });
    } catch (err) {
      logger.error('Failed to start IPC server', err as Error);
    }

    // Periodically fetch usage-API data for the dashboard
    let usageRefreshTimer: NodeJS.Timeout | null = null;
    const usageApiPlans = config.plans.filter(
      (plan) => plan.provider && providerRegistry.hasUsageApi(plan.provider)
    );
    const nonUsageApiPlans = config.plans.filter(
      (plan) => !plan.provider || !providerRegistry.hasUsageApi(plan.provider)
    );

    if (usageApiPlans.length > 0 || nonUsageApiPlans.length > 0) {
      const refreshQuotaData = async (): Promise<void> => {
        // Refresh usage-API plans
        for (const plan of usageApiPlans) {
          try {
            const decryptedKey = isApiKeyEncrypted(plan.apiKey)
              ? decryptApiKey(plan.apiKey, encryptionKey)
              : plan.apiKey;
            const adapter = providerRegistry.getUsageAdapter(plan.provider!);
            if (!adapter) continue;
            const result = await adapter.queryUsage(decryptedKey);
            dashboardMetrics.setProviderUsage(plan.name, {
              windows: (result.windows ?? []).map((w) => ({
                type: w.type,
                percentage: w.percentage,
                windowLabel: w.windowLabel,
                nextResetTime: w.nextResetTime,
              })),
              lastUpdated: new Date().toISOString(),
            }, plan.provider);
          } catch (err) {
            logger.debug('Failed to fetch usage-API data for dashboard', {
              planName: plan.name,
              error: (err as Error).message,
            });
          }
        }

        // Refresh local quota for non-usage-API plans
        for (const plan of nonUsageApiPlans) {
          const planId = typeof plan.id === 'number' ? plan.id : undefined;
          if (!planId) continue;
          const quotaState = quotaManager.getQuotaState(planId);
          if (!quotaState) continue;
          const percentage = quotaState.limit > 0
            ? Math.round((quotaState.used / quotaState.limit) * 100)
            : 0;
          dashboardMetrics.setLocalQuota(plan.name, {
            percentage,
            resetAt: quotaState.resetAt?.toISOString() ?? null,
            limit: quotaState.limit,
            used: quotaState.used,
          }, plan.provider);
        }
      };

      // Fetch immediately, then every 60s
      void refreshQuotaData();
      usageRefreshTimer = setInterval(refreshQuotaData, 60_000);
    }

    // Create application with managers
    const app = await createApp({
      port: parseInt(process.env.PORT ?? '8080', 10),
      logLevel: process.env.LOG_LEVEL ?? 'info',
      quotaManager,
      providerRegistry,
      apiKeyManager,
      usageTracker,
      planUsageTracker,
      enableAuth: process.env.ENABLE_AUTH !== 'false',
    });

    // Add shutdown hook for expiration scheduler
    app.addHook('onClose', async () => {
      logger.info('Shutting down expiration scheduler...');
      expirationScheduler.stop();
    });

    // Add shutdown hook for plan usage tracker
    app.addHook('onClose', async () => {
      logger.info('Shutting down plan usage tracker...');
      await planUsageTracker.shutdown();
    });

    // Add shutdown hook for IPC server
    app.addHook('onClose', async () => {
      logger.info('Shutting down IPC server...');
      await ipcServer.stop();
    });

    // Add shutdown hook for usage-API refresh timer
    app.addHook('onClose', () => {
      if (usageRefreshTimer) clearInterval(usageRefreshTimer);
    });

    // Start server
    await startServer(app);

  } catch (error) {
    logger.fatal('Failed to start application', error as Error, { component: 'main' });
    process.exit(1);
  }
}

// Run main
void main();
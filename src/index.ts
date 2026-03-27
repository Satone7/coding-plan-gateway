/**
 * Application entry point.
 * Creates and starts the Fastify server.
 */

// Load environment variables from .env file (must be first import)
import 'dotenv/config';

import { createApp, startServer } from './app';
import { logger } from './utils/logger';
import { loadConfig } from './config';
import { createQuotaManager } from './services/quota-manager';
import { createApiKeyManager } from './services/api-key-manager';
import { createUsageTracker } from './services/usage-tracker';
import { createPlanUsageTracker } from './services/plan-usage-tracker';
import { createExpirationScheduler } from './services/expiration-scheduler';
import { createPlanRepository } from './services/plan-repository';
import { loadAuthConfig } from './config/auth-config';
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
    const config = await loadConfig(configPath, encryptionKey);

    // Create and initialize quota manager
    const quotaManager = createQuotaManager({
      quotaStatePath: process.env.QUOTA_STATE_PATH,
      syncIntervalMs: process.env.QUOTA_SYNC_INTERVAL
        ? parseInt(process.env.QUOTA_SYNC_INTERVAL, 10)
        : undefined,
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
      { checkIntervalMs: 60000 } // Check every minute
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

    // Create application with managers
    const app = await createApp({
      port: parseInt(process.env.PORT ?? '8080', 10),
      logLevel: process.env.LOG_LEVEL ?? 'info',
      quotaManager,
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

    // Start server
    await startServer(app);

  } catch (error) {
    logger.fatal('Failed to start application', error as Error);
    process.exit(1);
  }
}

// Run main
void main();
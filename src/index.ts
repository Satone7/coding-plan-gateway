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
import { loadAuthConfig } from './config/auth-config';

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
    await quotaManager.initialize(config.plans);
    quotaManager.startPeriodicSync();

    // Create and initialize API key manager
    const authConfig = loadAuthConfig();
    const apiKeyManager = createApiKeyManager({
      apiKeysPath: authConfig.apiKeysPath,
    });
    await apiKeyManager.initialize();

    // Create application with managers
    const app = await createApp({
      port: parseInt(process.env.PORT ?? '8080', 10),
      logLevel: process.env.LOG_LEVEL ?? 'info',
      quotaManager,
      apiKeyManager,
      enableAuth: process.env.ENABLE_AUTH !== 'false',
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
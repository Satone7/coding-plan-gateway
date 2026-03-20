/**
 * Application entry point.
 * Creates and starts the Fastify server.
 */

import { createApp, startServer } from './app';
import { logger } from './utils/logger';
import { loadConfig } from './config';
import { validate } from './utils/validators';

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
    await loadConfig(configPath, encryptionKey);

    // Create application
    const app = await createApp({
      port: parseInt(process.env.PORT ?? '8080', 10),
      logLevel: process.env.LOG_LEVEL ?? 'info',
    });

    // Start server
    await startServer(app);

  } catch (error) {
    logger.fatal('Failed to start application', error as Error);
    process.exit(1);
  }
}

// Run main
main();
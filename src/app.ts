/**
 * Fastify application factory.
 * Creates and configures the Fastify server instance.
 */

import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from '@/middleware/error-handler';
import { registerRequestLogger } from '@/middleware/request-logger';
import { registerAuthMiddleware } from '@/middleware/auth';
import { registerRoutes } from '@/routes';
import { registerInternalApiKeyRoutes, registerReloadRoutes } from '@/routes/internal';
import { logger } from '@/utils/logger';
import { DEFAULT_SERVER_CONFIG } from '@/config/defaults';
import type { QuotaManager } from '@/services/quota-manager';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { UsageTracker } from '@/services/usage-tracker';

/**
 * Application configuration options.
 */
export interface AppOptions extends Partial<FastifyServerOptions> {
  /** Server port */
  port?: number;
  /** Server host */
  host?: string;
  /** Log level */
  logLevel?: string;
  /** Quota manager for graceful shutdown */
  quotaManager?: QuotaManager;
  /** API key manager for authentication */
  apiKeyManager?: ApiKeyManager;
  /** Usage tracker for recording API usage */
  usageTracker?: UsageTracker;
  /** Enable authentication middleware */
  enableAuth?: boolean;
}

/**
 * Create and configure a Fastify application instance.
 *
 * @param options - Application configuration options
 * @returns Configured Fastify instance
 *
 * @example
 * ```typescript
 * const app = await createApp({ port: 8080 });
 * await app.listen({ port: 8080, host: '0.0.0.0' });
 * ```
 */
export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const port = options.port ?? DEFAULT_SERVER_CONFIG.port;
  const host = options.host ?? DEFAULT_SERVER_CONFIG.host;
  const logLevel = options.logLevel ?? DEFAULT_SERVER_CONFIG.logLevel;

  // Create Fastify instance
  const app = Fastify({
    logger: false, // We use our own logger
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    ignoreTrailingSlash: true,
    maxParamLength: 100,
    ...options,
  });

  // Register middleware
  registerRequestLogger(app, options.usageTracker);

  // Register auth middleware if apiKeyManager is provided
  if (options.apiKeyManager && options.enableAuth !== false) {
    registerAuthMiddleware(app, {
      apiKeyManager: options.apiKeyManager,
      usageTracker: options.usageTracker,
    });
  }

  registerErrorHandler(app);

  // Register routes
  await registerRoutes(app);

  // Register internal API key routes if apiKeyManager is provided
  if (options.apiKeyManager) {
    await registerInternalApiKeyRoutes(app, {
      apiKeyManager: options.apiKeyManager,
      usageTracker: options.usageTracker,
      prefix: '/internal',
    });

    // Register reload routes for CLI notifications
    await registerReloadRoutes(app, {
      apiKeyManager: options.apiKeyManager,
      usageTracker: options.usageTracker,
    });
  }

  // Register onClose hook for quota manager shutdown
  if (options.quotaManager) {
    app.addHook('onClose', async () => {
      logger.info('Shutting down quota manager...');
      await options.quotaManager!.shutdown();
    });
  }

  // Register onClose hook for API key manager shutdown
  if (options.apiKeyManager) {
    app.addHook('onClose', async () => {
      logger.info('Shutting down API key manager...');
      await options.apiKeyManager!.persistKeys();
    });
  }

  // Register onClose hook for usage tracker shutdown
  if (options.usageTracker) {
    app.addHook('onClose', async () => {
      logger.info('Shutting down usage tracker...');
      await options.usageTracker!.shutdown();
    });
  }

  // Add graceful shutdown hooks
  const signals = ['SIGINT', 'SIGTERM'] as const;

  for (const signal of signals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      app.close()
        .then(() => {
          logger.info('Server closed successfully');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('Error during shutdown', error as Error);
          process.exit(1);
        });
    });
  }

  // Log startup info
  app.addHook('onReady', () => {
    logger.info(`Server ready`, {
      port,
      host,
      logLevel,
      nodeEnv: process.env.NODE_ENV ?? 'development',
    });
  });

  return app;
}

/**
 * Start the application server.
 *
 * @param app - The Fastify instance
 * @param options - Server options
 */
export async function startServer(
  app: FastifyInstance,
  options: { port?: number; host?: string } = {}
): Promise<void> {
  const port = options.port ?? parseInt(process.env.PORT ?? '8080', 10);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    logger.info(`Server listening on ${host}:${port}`);
  } catch (error) {
    logger.error('Failed to start server', error as Error);
    throw error;
  }
}
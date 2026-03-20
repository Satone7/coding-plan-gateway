/**
 * Fastify application factory.
 * Creates and configures the Fastify server instance.
 */

import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { registerErrorHandler } from '@/middleware/error-handler';
import { registerRequestLogger } from '@/middleware/request-logger';
import { registerRoutes } from '@/routes';
import { logger } from '@/utils/logger';
import { DEFAULT_SERVER_CONFIG } from '@/config/defaults';

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
  registerRequestLogger(app);
  registerErrorHandler(app);

  // Register routes
  await registerRoutes(app);

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
/**
 * Health routes for monitoring and readiness checks.
 * Provides endpoints for Kubernetes probes and load balancer health checks.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Health check response.
 */
interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks?: {
    database?: 'ok' | 'error';
    storage?: 'ok' | 'error';
  };
}

/**
 * Readiness check response.
 */
interface ReadinessResponse {
  ready: boolean;
  timestamp: string;
  checks: {
    config: boolean;
    plans: boolean;
  };
  message?: string;
}

/**
 * Application start time for uptime calculation.
 */
const startTime = Date.now();

/**
 * Get package version.
 */
function getVersion(): string {
  // Default version if package.json cannot be read
  return '1.0.0';
}

/**
 * Health check options.
 */
export interface HealthRoutesOptions {
  /** Check if configuration is loaded */
  configLoaded?: boolean;
  /** Number of active plans */
  planCount?: number;
  /** Custom health check function */
  customCheck?: () => Promise<boolean>;
}

/**
 * Create health handlers.
 */
// eslint-disable-next-line max-lines-per-function
function createHealthHandlers(options: HealthRoutesOptions = {}): {
  healthCheck: (request: FastifyRequest, reply: FastifyReply) => HealthResponse;
  readinessCheck: (request: FastifyRequest, reply: FastifyReply) => ReadinessResponse;
} {
  return {
    /**
     * GET /health - Liveness probe.
     * Returns 200 if the process is running.
     */
    healthCheck(
      _request: FastifyRequest,
      _reply: FastifyReply
    ): HealthResponse {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const version = getVersion();

      // Basic liveness check - process is running
      const response: HealthResponse = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version,
        uptime,
      };

      return response;
    },

    /**
     * GET /ready - Readiness probe.
     * Returns 200 if the service can handle requests.
     */
    readinessCheck(
      _request: FastifyRequest,
      reply: FastifyReply
    ): ReadinessResponse {
      const checks = {
        config: options.configLoaded ?? true,
        plans: (options.planCount ?? 0) >= 0, // At least initialized
      };

      const ready = checks.config && checks.plans;
      const statusCode = ready ? 200 : 503;

      const response: ReadinessResponse = {
        ready,
        timestamp: new Date().toISOString(),
        checks,
      };

      if (!ready) {
        const failedChecks = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        response.message = `Not ready: ${failedChecks.join(', ')}`;
      }

      void reply.status(statusCode);
      return response;
    },
  };
}

/**
 * Register health routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Health check options
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRoutesOptions = {}
): void {
  const handlers = createHealthHandlers(options);

  // GET /health - Liveness probe (always returns 200 if process is alive)
  app.get('/health', handlers.healthCheck);

  // GET /ready - Readiness probe (returns 503 if not ready)
  app.get('/ready', handlers.readinessCheck);
}

/**
 * Health check function for external use.
 */
export function createHealthCheck(
  options: HealthRoutesOptions
): () => Promise<HealthResponse> {
  const handlers = createHealthHandlers(options);
  return async () => handlers.healthCheck({} as FastifyRequest, {} as FastifyReply);
}

/**
 * Readiness check function for external use.
 */
export function createReadinessCheck(
  options: HealthRoutesOptions
): () => Promise<ReadinessResponse> {
  const handlers = createHealthHandlers(options);
  return async () => handlers.readinessCheck({} as FastifyRequest, {} as FastifyReply);
}
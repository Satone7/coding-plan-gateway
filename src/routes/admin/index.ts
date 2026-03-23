/**
 * Admin routes registration.
 * Provides CRUD endpoints for coding plan configuration and quota management.
 */

import { FastifyInstance } from 'fastify';
import { createAdminHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import type { QuotaManager } from '@/services/quota-manager';

/**
 * Options for admin routes.
 */
export interface AdminRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Quota manager instance (optional) */
  quotaManager?: QuotaManager;
  /** API prefix (default: '/api') */
  prefix?: string;
}

/**
 * Register admin routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options including repository and optional quota manager
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  options: AdminRoutesOptions
): Promise<void> {
  const { repository, quotaManager, prefix = '/api' } = options;
  const handlers = createAdminHandlers(repository, quotaManager);

  await app.register(
    (fastify, _options, done) => {
      // Plan CRUD endpoints
      // GET /api/plans - List all plans
      fastify.get('/plans', handlers.listPlans);

      // POST /api/plans - Create a new plan
      fastify.post('/plans', handlers.createPlan);

      // GET /api/plans/:planId - Get a specific plan
      fastify.get('/plans/:planId', handlers.getPlan);

      // PUT /api/plans/:planId - Update a plan
      fastify.put('/plans/:planId', handlers.updatePlan);

      // DELETE /api/plans/:planId - Delete a plan
      fastify.delete('/plans/:planId', handlers.deletePlan);

      // Quota management endpoints (only if quotaManager is provided)
      if (quotaManager) {
        // GET /api/quota/:planId - Get quota status for a plan
        fastify.get('/quota/:planId', handlers.getQuotaStatus);

        // POST /api/quota/:planId/reset - Reset quota for a plan
        fastify.post('/quota/:planId/reset', handlers.resetQuota);
      }

      done();
    },
    { prefix }
  );
}
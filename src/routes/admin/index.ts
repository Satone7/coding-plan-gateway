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
    (fastify) => {
      // Plan CRUD endpoints
      // GET /api/plans - List all plans
      fastify.get('/plans', (request, reply) => handlers.listPlans(request, reply));

      // POST /api/plans - Create a new plan
      fastify.post('/plans', (request, reply) => handlers.createPlan(request, reply));

      // GET /api/plans/:planId - Get a specific plan
      fastify.get('/plans/:planId', (request, reply) => handlers.getPlan(request, reply));

      // PUT /api/plans/:planId - Update a plan
      fastify.put('/plans/:planId', (request, reply) => handlers.updatePlan(request, reply));

      // DELETE /api/plans/:planId - Delete a plan
      fastify.delete('/plans/:planId', (request, reply) => handlers.deletePlan(request, reply));

      // Quota management endpoints (only if quotaManager is provided)
      if (quotaManager) {
        // GET /api/quota/:planId - Get quota status for a plan
        fastify.get('/quota/:planId', (request, reply) => handlers.getQuotaStatus(request, reply));

        // POST /api/quota/:planId/reset - Reset quota for a plan
        fastify.post('/quota/:planId/reset', (request, reply) => handlers.resetQuota(request, reply));
      }
    },
    { prefix }
  );
}
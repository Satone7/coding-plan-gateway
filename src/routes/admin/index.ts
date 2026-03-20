/**
 * Admin routes registration.
 * Provides CRUD endpoints for coding plan configuration.
 */

import { FastifyInstance } from 'fastify';
import { createAdminHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';

/**
 * Options for admin routes.
 */
export interface AdminRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** API prefix (default: '/api') */
  prefix?: string;
}

/**
 * Register admin routes with Fastify.
 *
 * @param app - Fastify instance
 * @param options - Route options including repository
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  options: AdminRoutesOptions
): Promise<void> {
  const { repository, prefix = '/api' } = options;
  const handlers = createAdminHandlers(repository);

  await app.register(
    async (fastify) => {
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
    },
    { prefix }
  );
}
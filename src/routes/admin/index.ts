/**
 * Admin routes registration.
 * Provides CRUD endpoints for coding plan configuration and quota management.
 */

import { FastifyInstance } from 'fastify';
import { createAdminHandlers } from './handlers';
import { IPlanRepository } from '@/services/plan-repository';
import type { QuotaManager } from '@/services/quota-manager';
import type { PlanUsageTracker } from '@/services/plan-usage-tracker';

/**
 * Options for admin routes.
 */
export interface AdminRoutesOptions {
  /** Plan repository instance */
  repository: IPlanRepository;
  /** Quota manager instance (optional) */
  quotaManager?: QuotaManager;
  /** Plan usage tracker instance (optional) */
  planUsageTracker?: PlanUsageTracker;
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
  const { repository, quotaManager, planUsageTracker, prefix = '/api' } = options;
  const handlers = createAdminHandlers(repository, quotaManager, planUsageTracker);

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

      // Quota sync endpoint (requires both quotaManager and planUsageTracker)
      if (quotaManager && planUsageTracker) {
        // POST /api/quota/:planId/sync - Sync quota state with PlanUsageTracker
        fastify.post('/quota/:planId/sync', handlers.syncQuota);
      }

      // Plan usage tracking endpoints (only if planUsageTracker is provided)
      if (planUsageTracker) {
        // GET /api/plans/usage/summary - Get usage summary for all plans
        fastify.get('/plans/usage/summary', handlers.getPlansUsageSummary);

        // GET /api/plans/:planId/usage - Get plan usage report
        fastify.get('/plans/:planId/usage', handlers.getPlanUsage);

        // POST /api/plans/:planId/usage/adjust - Adjust plan usage
        fastify.post('/plans/:planId/usage/adjust', handlers.adjustPlanUsage);

        // GET /api/plans/:planId/usage/history - Get usage adjustment history
        fastify.get('/plans/:planId/usage/history', handlers.getUsageAdjustmentHistory);
      }

      // POST /api/reload - Reload configuration
      fastify.post('/reload', handlers.reloadConfig);

      done();
    },
    { prefix }
  );
}
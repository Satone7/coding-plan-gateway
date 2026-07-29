/**
 * Read-only web dashboard routes.
 * Serves a zero-build single-page HTML app plus JSON metric endpoints.
 * Monitoring only — no mutating operations are exposed here.
 *
 * @module routes/web-dashboard
 */

import type { FastifyInstance } from 'fastify';
import { dashboardMetrics } from '@/utils/dashboard-metrics';
import { renderDashboardPage } from './page';

/** Maximum age (in minutes) a flow event may have and still be charted */
const MAX_WINDOW_MINUTES = 24 * 60;

/**
 * Register the read-only web dashboard.
 *
 * GET /dashboard              → self-contained HTML page (no build step)
 * GET /api/dashboard/flows    → aggregated request → model → plan chains
 * GET /api/dashboard/summary  → headline counters + per-plan/model usage
 * GET /api/dashboard/errors   → recent upstream/gateway errors
 *
 * Note: these paths are NOT in the default auth-exempt list, so when auth is
 * enabled the browser must supply a valid API key (the page prompts for one).
 */
export function registerWebDashboardRoutes(app: FastifyInstance): void {
  app.get('/dashboard', (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderDashboardPage());
  });

  app.get<{ Querystring: { minutes?: string } }>(
    '/api/dashboard/flows',
    (request) => {
      const snapshot = dashboardMetrics.getSnapshot();
      const rawMinutes = Number(request.query.minutes);
      const minutes =
        Number.isFinite(rawMinutes) && rawMinutes > 0
          ? Math.min(rawMinutes, MAX_WINDOW_MINUTES)
          : 60;
      const cutoff = Date.now() - minutes * 60_000;
      const flows = snapshot.flows.filter((f) => new Date(f.at).getTime() >= cutoff);
      return {
        windowMinutes: minutes,
        serverTime: new Date().toISOString(),
        flows,
      };
    }
  );

  app.get('/api/dashboard/summary', () => {
    const snapshot = dashboardMetrics.getSnapshot();
    return {
      completedRequests: snapshot.completedRequests,
      failedRequests: snapshot.failedRequests,
      planUsages: snapshot.planUsages,
      modelUsages: snapshot.modelUsages,
      providerUsage: snapshot.providerUsage,
      localQuota: snapshot.localQuota,
      planProviders: snapshot.planProviders,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/dashboard/errors', () => {
    const snapshot = dashboardMetrics.getSnapshot();
    return {
      errors: snapshot.recentErrors,
      serverTime: new Date().toISOString(),
    };
  });
}

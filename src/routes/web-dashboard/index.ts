/**
 * Read-only web dashboard routes.
 * Serves a zero-build single-page HTML app plus JSON metric endpoints.
 * Monitoring only — no mutating operations are exposed here.
 *
 * @module routes/web-dashboard
 */

import type { FastifyInstance } from 'fastify';
import { dashboardMetrics } from '@/utils/dashboard-metrics';
import { getActiveUsageStatsStore } from '@/services/usage-stats-store';
import { getActiveBalanceHistoryStore } from '@/services/balance-history-store';
import { renderDashboardPage } from './page';

/**
 * Register the read-only web dashboard.
 *
 * GET /dashboard                      → self-contained HTML page (no build step)
 * GET /api/dashboard/summary          → headline counters + in-flight requests +
 *                                       recent requests + per-key/model/plan usage +
 *                                       per-plan remaining quota rows
 * GET /api/dashboard/errors           → recent upstream/gateway errors
 * GET /api/dashboard/stats            → persisted historical token stats
 * GET /api/dashboard/balance-history  → persisted hourly OHLC balance candles
 *
 * Note: `/dashboard` and `/api/dashboard/*` are in the default auth-exempt
 * list (read-only aggregated metrics only), so no key is required. Operators
 * can lock them down by overriding AUTH_EXEMPT_PATHS; the page will then
 * prompt for a key.
 */
export function registerWebDashboardRoutes(app: FastifyInstance): void {
  app.get('/dashboard', (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderDashboardPage());
  });

  registerSummaryAndErrors(app);
  registerStats(app);
  registerBalanceHistory(app);
}

/** Live counters + in-flight/recent requests + quota rows + recent errors */
function registerSummaryAndErrors(app: FastifyInstance): void {
  app.get('/api/dashboard/summary', () => {
    const snapshot = dashboardMetrics.getSnapshot();
    return {
      completedRequests: snapshot.completedRequests,
      failedRequests: snapshot.failedRequests,
      activeRequests: snapshot.activeRequests,
      recentRequests: snapshot.recentRequests,
      planUsages: snapshot.planUsages,
      modelUsages: snapshot.modelUsages,
      apiKeyUsages: snapshot.apiKeyUsages,
      planQuotas: dashboardMetrics.buildPlanQuotaRows(),
      activeDiagnostics: dashboardMetrics.getActiveDiagnostics(),
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

/**
 * Historical, persisted token stats (per-day series + per-plan / per-model
 * breakdowns) from the on-disk UsageStatsStore. Unlike the in-memory
 * counters in /summary (current run only), this survives restarts and
 * covers the retention window.
 */
function registerStats(app: FastifyInstance): void {
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/dashboard/stats',
    (request, reply) => {
      const store = getActiveUsageStatsStore();
      if (!store) {
        return reply.status(503).send({
          error: { message: 'Usage stats store not initialized', type: 'service_unavailable' },
        });
      }
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const from =
        request.query.from && dateRe.test(request.query.from) ? request.query.from : undefined;
      const to = request.query.to && dateRe.test(request.query.to) ? request.query.to : undefined;
      return store.query(from, to);
    }
  );
}

/**
 * Persisted hourly OHLC balance candles for balance-type plans (e.g.
 * DeepSeek), from the on-disk BalanceHistoryStore. `hours` selects the
 * trailing window (default 168 = 7 days, clamped to the retention window).
 */
function registerBalanceHistory(app: FastifyInstance): void {
  app.get<{ Querystring: { hours?: string; planKey?: string } }>(
    '/api/dashboard/balance-history',
    (request, reply) => {
      const store = getActiveBalanceHistoryStore();
      if (!store) {
        return reply.status(503).send({
          error: { message: 'Balance history store not initialized', type: 'service_unavailable' },
        });
      }
      const hours = Number.parseInt(request.query.hours ?? '', 10);
      return store.query({
        hours: Number.isFinite(hours) ? hours : undefined,
        planKey: request.query.planKey || undefined,
      });
    }
  );
}

/**
 * Unit tests for the read-only web dashboard routes.
 * The dashboard serves a zero-build HTML page plus JSON metric endpoints
 * fed by the shared DashboardMetrics singleton.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerWebDashboardRoutes } from '@/routes/web-dashboard';
import { dashboardMetrics } from '@/utils/dashboard-metrics';

let seedCounter = 0;

function seedRequest(overrides: { apiKey?: string; plan?: string; model?: string; status?: number } = {}): string {
  const requestId = `req-seed-${seedCounter++}`;
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request started',
    context: {
      requestId,
      method: 'POST',
      url: '/api/v1/chat/completions',
    },
  });
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request authenticated',
    context: { requestId, keyName: overrides.apiKey ?? 'tester' },
  });
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request completed',
    context: {
      requestId,
      statusCode: overrides.status ?? 200,
      durationMs: 100,
      provider: {
        planId: 1,
        planName: overrides.plan ?? 'Plan-A',
        model: overrides.model ?? 'k3',
        statusCode: overrides.status ?? 200,
      },
      tokens: { input: 10, output: 5, total: 15 },
    },
  });
  return requestId;
}

/** Seed an in-flight request (start + auth, no completion) */
function seedActive(requestId: string, keyName = 'live-tester'): void {
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request started',
    context: { requestId, method: 'POST', url: '/api/v1/messages' },
  });
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request authenticated',
    context: { requestId, keyName },
  });
}

describe('Web Dashboard Routes', () => {
  beforeEach(() => {
    // The metrics singleton is module-scoped and shared across tests;
    // assertions use unique plan/model names or tolerant matchers.
  });

  describe('GET /dashboard', () => {
    it('should serve the HTML page with no external asset references', async () => {
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/dashboard' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      const body = response.body;
      // the four core panels
      expect(body).toContain('进行中请求');
      expect(body).toContain('按 API Key 的 Token 用量');
      expect(body).toContain('按模型的 Token 用量');
      expect(body).toContain('Plan 余量 / 余额');
      // no flow diagram leftovers
      expect(body).not.toContain('请求流向');
      // fully self-contained: no CDN/script/link references
      expect(body).not.toMatch(/src="http/);
      expect(body).not.toMatch(/href="http/);
    });
  });

  describe('GET /api/dashboard/summary', () => {
    it('should return counters and per-plan usage', async () => {
      seedRequest({ model: 'k3', plan: 'Summary-Plan' });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('completedRequests');
      expect(body).toHaveProperty('failedRequests');
      expect(body.planUsages['Summary-Plan'].requests).toBeGreaterThanOrEqual(1);
    });

    it('should expose in-flight requests in activeRequests', async () => {
      seedActive('req-active-route-test');
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.activeRequests)).toBe(true);
      const active = body.activeRequests.find(
        (r: { requestId: string }) => r.requestId === 'req-active-route-test'
      );
      expect(active).toBeDefined();
      expect(active.apiKey).toBe('live-tester');
      expect(active.format).toBe('anthropic');
      expect(typeof active.elapsedMs).toBe('number');
    });

    it('should expose finished requests in recentRequests', async () => {
      seedRequest({ model: 'k3-recent', plan: 'Recent-Plan' });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      const body = response.json();
      expect(Array.isArray(body.recentRequests)).toBe(true);
      const row = body.recentRequests.find((r: { plan: string }) => r.plan === 'Recent-Plan');
      expect(row).toBeDefined();
      expect(row.model).toBe('k3-recent');
      expect(row.apiKey).toBe('tester');
    });

    it('should expose per-key token usage in apiKeyUsages', async () => {
      seedRequest({ apiKey: 'route-key-check' });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      const body = response.json();
      expect(body.apiKeyUsages['route-key-check'].tokens).toBeGreaterThanOrEqual(15);
    });

    it('should expose planQuotas rows only for plans with an accurate signal', async () => {
      dashboardMetrics.setLocalQuota('Route-Quota-Plan', {
        percentage: 40,
        resetAt: null,
        limit: 500,
        used: 200,
      });
      dashboardMetrics.setLocalQuota('Route-Unlimited-Plan', {
        percentage: 0,
        resetAt: null,
        limit: 0,
        used: 0,
      });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      const body = response.json();
      expect(Array.isArray(body.planQuotas)).toBe(true);
      const row = body.planQuotas.find(
        (r: { planName: string }) => r.planName === 'Route-Quota-Plan'
      );
      expect(row).toBeDefined();
      expect(row.kind).toBe('local-quota');
      expect(row.remaining).toBe(300);
      const unlimited = body.planQuotas.find(
        (r: { planName: string }) => r.planName === 'Route-Unlimited-Plan'
      );
      expect(unlimited).toBeUndefined();
    });

    it('should not expose the removed flows endpoint', async () => {
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/flows' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/dashboard/errors', () => {
    it('should return recent error entries', async () => {
      dashboardMetrics.processEntry({
        level: 'error',
        message: 'Request failed',
        error: { name: 'Error', message: 'upstream 401', code: 'UPSTREAM_ERROR' },
        context: { requestId: 'req-err' },
      });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/errors' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.errors)).toBe(true);
      const err = body.errors.find((e: { message: string }) => e.message === 'Request failed');
      expect(err).toBeDefined();
      expect(err.error.message).toBe('upstream 401');
    });
  });
});

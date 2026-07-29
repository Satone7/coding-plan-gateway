/**
 * Unit tests for the read-only web dashboard routes.
 * The dashboard serves a zero-build HTML page plus JSON metric endpoints
 * fed by the shared DashboardMetrics singleton.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerWebDashboardRoutes } from '@/routes/web-dashboard';
import { dashboardMetrics, type FlowChain } from '@/utils/dashboard-metrics';

function seedFlow(overrides: Partial<FlowChain> = {}): void {
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request started',
    context: {
      requestId: overrides.at ?? 'req-seed',
      method: 'POST',
      url: '/api/v1/chat/completions',
    },
  });
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request authenticated',
    context: { requestId: overrides.at ?? 'req-seed', keyName: overrides.apiKey ?? 'tester' },
  });
  dashboardMetrics.processEntry({
    level: 'info',
    message: 'Request completed',
    context: {
      requestId: overrides.at ?? 'req-seed',
      statusCode: overrides.status ?? 200,
      durationMs: overrides.durationMs ?? 100,
      provider: {
        planId: 1,
        planName: overrides.plan ?? 'Plan-A',
        model: overrides.model ?? 'k3',
        statusCode: overrides.status ?? 200,
      },
      tokens: {
        input: 10,
        output: 5,
        total: overrides.totalTokens ?? 15,
      },
    },
  });
}

describe('Web Dashboard Routes', () => {
  beforeEach(() => {
    // Reset the singleton between tests by re-seeding known state only;
    // the singleton is module-scoped, so tests only assert on shape/values
    // they control (or use tolerant matchers).
  });

  describe('GET /dashboard', () => {
    it('should serve the HTML page with no external asset references', async () => {
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/dashboard' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      const body = response.body;
      expect(body).toContain('请求流向');
      // fully self-contained: no CDN/script/link references
      expect(body).not.toMatch(/src="http/);
      expect(body).not.toMatch(/href="http/);
    });
  });

  describe('GET /api/dashboard/flows', () => {
    it('should return flows within the requested window', async () => {
      seedFlow({ model: 'k3', plan: 'Kimi-A' });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/flows?minutes=60',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.windowMinutes).toBe(60);
      expect(Array.isArray(body.flows)).toBe(true);
      expect(body.flows.length).toBeGreaterThan(0);
      const flow = body.flows.find((f: FlowChain) => f.plan === 'Kimi-A');
      expect(flow).toBeDefined();
      expect(flow.model).toBe('k3');
      expect(flow.apiKey).toBe('tester');
    });

    it('should default to a 60-minute window and clamp invalid values', async () => {
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const def = await app.inject({ method: 'GET', url: '/api/dashboard/flows' });
      expect(def.json().windowMinutes).toBe(60);

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/dashboard/flows?minutes=-5',
      });
      expect(invalid.json().windowMinutes).toBe(60);
    });
  });

  describe('GET /api/dashboard/summary', () => {
    it('should return counters and per-plan usage', async () => {
      seedFlow({ model: 'k3', plan: 'Summary-Plan' });
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('completedRequests');
      expect(body).toHaveProperty('failedRequests');
      expect(body.planUsages['Summary-Plan'].requests).toBeGreaterThanOrEqual(1);
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

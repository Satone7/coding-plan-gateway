/**
 * Unit tests for the read-only web dashboard routes.
 * The dashboard serves a zero-build HTML page plus JSON metric endpoints
 * fed by the shared DashboardMetrics singleton.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { registerWebDashboardRoutes } from '@/routes/web-dashboard';
import {
  BalanceHistoryStore,
  registerActiveBalanceHistoryStore,
} from '@/services/balance-history-store';
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
  let balanceTempDir: string | null = null;

  beforeEach(() => {
    // The metrics singleton is module-scoped and shared across tests;
    // assertions use unique plan/model names or tolerant matchers.
  });

  afterEach(async () => {
    // Drop the balance-history singleton so the 503 test stays isolated
    registerActiveBalanceHistoryStore(null);
    if (balanceTempDir) {
      await rm(balanceTempDir, { recursive: true, force: true });
      balanceTempDir = null;
    }
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
      expect(body).toContain('Token 消耗 · 按 API Key');
      expect(body).toContain('按模型的 Token 用量');
      expect(body).toContain('Plan 余量 / 余额');
      // daily history renders as a GitHub-style calendar heatmap
      expect(body).toContain('历史 Token 日历');
      expect(body).toContain('hm-grid');
      expect(body).toContain('hmTip');
      // balance history: mini sparkline in quota cards + detail modal
      expect(body).toContain('余额历史');
      expect(body).toContain('balanceModal');
      expect(body).toContain('bmTitle');
      expect(body).toContain('bmBody');
      expect(body).toContain('balMiniHtml');
      // mini sparkline is a borderless full-card-width strip, drawn at the
      // button's measured pixel width after the cards render
      expect(body).toContain('balMiniSvg');
      expect(body).toContain('fillBalMinis');
      expect(body).toContain('q-mini-gran');
      expect(body).toContain('filterActiveCandles');
      // switchable K-line granularity (1h / 12h / 1d, client-side aggregation)
      expect(body).toContain('aggregateCandles');
      expect(body).toContain('bal-gbtn');
      expect(body).toContain('data-gran');
      expect(body).toContain('cpg_dash_bal_gran');
      expect(body).toContain('1h/12h/1d');
      // the always-on panel is gone — replaced by the modal
      expect(body).not.toContain('balancePanel');
      // long-running in-flight requests fold behind a toggle
      expect(body).toContain('longToggle');
      // no flow diagram leftovers
      expect(body).not.toContain('请求流向');
      // recent-requests and errors panels are paginated + filterable
      expect(body).toContain('近期完成的请求');
      expect(body).toContain('近期错误');
      expect(body).toContain('pager-btn');
      expect(body).toContain('fltRecentModel');
      expect(body).toContain('fltErrorQ');
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
      // local-quota rows carry only the reset time — no remaining/limit/bar
      expect(row.remaining).toBeUndefined();
      expect(row.limit).toBeUndefined();
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

  describe('GET /api/dashboard/balance-history', () => {
    it('should return 503 when the store is not initialized', async () => {
      registerActiveBalanceHistoryStore(null);
      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/balance-history' });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.type).toBe('service_unavailable');
      await app.close();
    });

    it('should return per-plan hourly OHLC candles', async () => {
      balanceTempDir = await mkdtemp(join(tmpdir(), 'balance-route-test-'));
      const store = new BalanceHistoryStore({
        historyPath: join(balanceTempDir, 'balance-history.json'),
      });
      await store.initialize();
      // anchor to a wall-clock hour so bucket math can't straddle a boundary;
      // samples land 55min and 56min into the previous hour, then the next hour
      const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      const t0 = hourStart - 5 * 60_000;
      store.record({ planKey: '7', planName: 'DeepSeek-A', providerId: 'deepseek', currency: 'CNY', balance: 100, at: t0 });
      store.record({ planKey: '7', planName: 'DeepSeek-A', providerId: 'deepseek', currency: 'CNY', balance: 90, at: t0 + 60_000 });
      store.record({ planKey: '7', planName: 'DeepSeek-A', providerId: 'deepseek', currency: 'CNY', balance: 95, at: t0 + 3_600_000 });
      registerActiveBalanceHistoryStore(store);

      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({ method: 'GET', url: '/api/dashboard/balance-history' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hours).toBe(168);
      expect(body.plans).toHaveLength(1);
      const plan = body.plans[0];
      expect(plan).toMatchObject({ planKey: '7', planName: 'DeepSeek-A', currency: 'CNY' });
      expect(plan.candles).toHaveLength(2);
      expect(plan.candles[0]).toMatchObject({ o: 100, h: 100, l: 90, c: 90, n: 2 });
      expect(plan.candles[1]).toMatchObject({ o: 95, h: 95, l: 95, c: 95, n: 1 });
      await app.close();
    });

    it('should honor the hours window parameter', async () => {
      balanceTempDir = await mkdtemp(join(tmpdir(), 'balance-route-test-'));
      const store = new BalanceHistoryStore({
        historyPath: join(balanceTempDir, 'balance-history.json'),
      });
      await store.initialize();
      // two samples 3 hours apart; a 2h window only covers the later one
      const now = Date.now();
      store.record({ planKey: '9', planName: 'DeepSeek-B', balance: 10, at: now - 3 * 3_600_000 });
      store.record({ planKey: '9', planName: 'DeepSeek-B', balance: 12, at: now });
      registerActiveBalanceHistoryStore(store);

      const app = Fastify();
      await registerWebDashboardRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/balance-history?hours=2',
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hours).toBe(2);
      expect(body.plans[0].candles).toHaveLength(1);
      expect(body.plans[0].candles[0].o).toBe(12);
      await app.close();
    });
  });
});

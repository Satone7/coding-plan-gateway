/**
 * Unit tests for DashboardMetrics utility.
 * Covers quota-extraction helpers, the in-flight request tracker, the
 * recent-request buffer, and the plan-quota row builder.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DashboardMetrics,
  windowDurationMs,
  type ProviderUsageSnapshot,
} from '@/utils/dashboard-metrics';

/** Push a full start → (auth) → completion cycle through the aggregator */
function pushRequest(
  metrics: DashboardMetrics,
  overrides: {
    requestId?: string;
    url?: string;
    keyName?: string;
    completion?: Record<string, unknown>;
  } = {}
): void {
  const requestId = overrides.requestId ?? 'req-1';
  metrics.processEntry({
    level: 'info',
    message: 'Request started',
    context: {
      requestId,
      method: 'POST',
      url: overrides.url ?? '/api/v1/chat/completions',
    },
  });
  if (overrides.keyName) {
    metrics.processEntry({
      level: 'info',
      message: 'Request authenticated',
      context: { requestId, keyName: overrides.keyName },
    });
  }
  metrics.processEntry({
    level: 'info',
    message: 'Request completed',
    context: {
      requestId,
      statusCode: 200,
      durationMs: 1234,
      provider: { planId: 1, planName: 'Kimi-A', model: 'k3', statusCode: 200 },
      tokens: { input: 100, output: 50, total: 150 },
      ...overrides.completion,
    },
  });
}

describe('DashboardMetrics', () => {
  describe('getUsageResetTimes', () => {
    it('should return empty map when no providerUsage data', () => {
      const metrics = new DashboardMetrics();
      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);

      const result = metrics.getUsageResetTimes(planIdMap);
      expect(result.size).toBe(0);
    });

    it('should return empty map when plan name not in planIdMap', () => {
      const metrics = new DashboardMetrics();
      const snapshot: ProviderUsageSnapshot = {
        windows: [
          { type: '5h', percentage: 50, windowLabel: '5h', nextResetTime: Date.now() + 3600 * 1000 },
        ],
        lastUpdated: new Date().toISOString(),
      };
      metrics.setProviderUsage('UnknownPlan', snapshot);

      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);

      const result = metrics.getUsageResetTimes(planIdMap);
      expect(result.size).toBe(0);
    });

    it('should return latest reset time across all windows (longest cycle)', () => {
      const metrics = new DashboardMetrics();
      const now = Date.now();
      const snapshot: ProviderUsageSnapshot = {
        windows: [
          { type: 'weekly', percentage: 50, windowLabel: 'weekly', nextResetTime: now + 86400 * 1000 }, // 1 day
          { type: '5h', percentage: 30, windowLabel: '5h', nextResetTime: now + 3600 * 1000 }, // 1 hour (earlier)
          { type: 'monthly', percentage: 80, windowLabel: 'monthly', nextResetTime: now + 2592000 * 1000 }, // 30 days (latest)
        ],
        lastUpdated: new Date().toISOString(),
      };
      metrics.setProviderUsage('Zhipu_6', snapshot);

      const planIdMap = new Map<string, number>();
      planIdMap.set('Zhipu_6', 4);

      const result = metrics.getUsageResetTimes(planIdMap);
      expect(result.size).toBe(1);
      // Should return latest (monthly window) as it represents the real quota cycle boundary
      expect(result.get(4)).toBe(now + 2592000 * 1000);
    });

    it('should skip windows without nextResetTime', () => {
      const metrics = new DashboardMetrics();
      const now = Date.now();
      const snapshot: ProviderUsageSnapshot = {
        windows: [
          { type: 'total', percentage: 50, windowLabel: 'total' }, // No nextResetTime
          { type: '5h', percentage: 30, windowLabel: '5h', nextResetTime: now + 3600 * 1000 },
        ],
        lastUpdated: new Date().toISOString(),
      };
      metrics.setProviderUsage('Plan1', snapshot);

      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);

      const result = metrics.getUsageResetTimes(planIdMap);
      expect(result.size).toBe(1);
      expect(result.get(1)).toBe(now + 3600 * 1000);
    });

    it('should handle multiple plans with different reset times', () => {
      const metrics = new DashboardMetrics();
      const now = Date.now();

      metrics.setProviderUsage('Plan1', {
        windows: [{ type: '5h', percentage: 50, windowLabel: '5h', nextResetTime: now + 3600 * 1000 }],
        lastUpdated: new Date().toISOString(),
      });

      metrics.setProviderUsage('Plan2', {
        windows: [{ type: 'weekly', percentage: 30, windowLabel: 'weekly', nextResetTime: now + 86400 * 1000 }],
        lastUpdated: new Date().toISOString(),
      });

      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);
      planIdMap.set('Plan2', 2);

      const result = metrics.getUsageResetTimes(planIdMap);
      expect(result.size).toBe(2);
      expect(result.get(1)).toBe(now + 3600 * 1000);
      expect(result.get(2)).toBe(now + 86400 * 1000);
    });
  });

  describe('getUsagePercentages', () => {
    it('should return empty map when no providerUsage data', () => {
      const metrics = new DashboardMetrics();
      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);

      const result = metrics.getUsagePercentages(planIdMap);
      expect(result.size).toBe(0);
    });

    it('should return highest percentage across all windows', () => {
      const metrics = new DashboardMetrics();
      const snapshot: ProviderUsageSnapshot = {
        windows: [
          { type: '5h', percentage: 30, windowLabel: '5h', nextResetTime: Date.now() / 1000 + 3600 },
          { type: 'weekly', percentage: 56, windowLabel: 'weekly', nextResetTime: Date.now() / 1000 + 86400 }, // highest
          { type: 'monthly', percentage: 10, windowLabel: 'monthly', nextResetTime: Date.now() / 1000 + 2592000 },
        ],
        lastUpdated: new Date().toISOString(),
      };
      metrics.setProviderUsage('Zhipu_6', snapshot);

      const planIdMap = new Map<string, number>();
      planIdMap.set('Zhipu_6', 4);

      const result = metrics.getUsagePercentages(planIdMap);
      expect(result.size).toBe(1);
      expect(result.get(4)).toBe(56); // Should return highest percentage
    });

    it('should handle multiple plans with different percentages', () => {
      const metrics = new DashboardMetrics();

      metrics.setProviderUsage('Plan1', {
        windows: [{ type: '5h', percentage: 10, windowLabel: '5h', nextResetTime: Date.now() / 1000 + 3600 }],
        lastUpdated: new Date().toISOString(),
      });

      metrics.setProviderUsage('Plan2', {
        windows: [{ type: 'weekly', percentage: 80, windowLabel: 'weekly', nextResetTime: Date.now() / 1000 + 86400 }],
        lastUpdated: new Date().toISOString(),
      });

      const planIdMap = new Map<string, number>();
      planIdMap.set('Plan1', 1);
      planIdMap.set('Plan2', 2);

      const result = metrics.getUsagePercentages(planIdMap);
      expect(result.size).toBe(2);
      expect(result.get(1)).toBe(10);
      expect(result.get(2)).toBe(80);
    });

    it('should return 0 for plans with empty windows', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('EmptyPlan', {
        windows: [],
        lastUpdated: new Date().toISOString(),
      });

      const planIdMap = new Map<string, number>();
      planIdMap.set('EmptyPlan', 3);

      const result = metrics.getUsagePercentages(planIdMap);
      expect(result.size).toBe(1);
      expect(result.get(3)).toBe(0);
    });

    it('should preserve provider summary data in snapshots', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('DeepseekPlan', {
        windows: [],
        summary: {
          mode: 'balance',
          value: '¥12.34',
        },
        lastUpdated: new Date().toISOString(),
      });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.providerUsage.DeepseekPlan?.summary).toEqual({
        mode: 'balance',
        value: '¥12.34',
      });
    });
  });

  describe('active request tracking', () => {
    it('should track a started-but-unfinished proxy request as active', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-live', method: 'POST', url: '/api/v1/messages' },
      });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.activeRequests).toHaveLength(1);
      const active = snapshot.activeRequests[0]!;
      expect(active.requestId).toBe('req-live');
      expect(active.format).toBe('anthropic');
      expect(active.apiKey).toBe('anonymous');
      expect(active.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should attribute the API key once the auth log arrives', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-live2', method: 'POST', url: '/api/v1/chat/completions' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Request authenticated',
        context: { requestId: 'req-live2', keyName: 'claude-code' },
      });

      const active = metrics.getSnapshot().activeRequests[0]!;
      expect(active.apiKey).toBe('claude-code');
      expect(active.format).toBe('openai');
    });

    it('should remove the request from active once it completes', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { requestId: 'req-done', keyName: 'tester' });

      expect(metrics.getSnapshot().activeRequests).toHaveLength(0);
    });

    it('should not list non-proxy requests as active', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-models', method: 'GET', url: '/api/v1/models' },
      });

      expect(metrics.getSnapshot().activeRequests).toHaveLength(0);
    });

    it('should keep a request active between the error log and the completion log', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-failing', method: 'POST', url: '/api/v1/messages' },
      });
      metrics.processEntry({
        level: 'error',
        message: 'Request error',
        error: { name: 'Error', message: 'upstream 429' },
        context: { requestId: 'req-failing' },
      });

      // still in flight — the completion log has not arrived yet
      expect(metrics.getSnapshot().activeRequests).toHaveLength(1);

      metrics.processEntry({
        level: 'info',
        message: 'Request completed',
        context: { requestId: 'req-failing', statusCode: 429, durationMs: 41 },
      });
      expect(metrics.getSnapshot().activeRequests).toHaveLength(0);
    });

    it('should NOT backfill from an auth log without a start log (no URL to classify)', () => {
      const metrics = new DashboardMetrics();
      // "Request started" was missed (listener attached mid-flight / eviction).
      // The auth log alone carries no URL, so creating an entry would risk a
      // permanent ghost if the completion also never arrives — skip instead.
      metrics.processEntry({
        level: 'info',
        message: 'Request authenticated',
        context: { requestId: 'req-orphan', keyName: 'claude-code', path: '/api/v1/messages' },
      });

      expect(metrics.getSnapshot().activeRequests).toHaveLength(0);
    });

    it('should prune pending entries older than the stale threshold at snapshot time', () => {
      const metrics = new DashboardMetrics();
      const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-stuck', method: 'POST', url: '/api/v1/messages' },
      });
      // age the entry beyond the 30-minute stale threshold (simulating a
      // client disconnect whose completion log never arrived)
      metrics.agePendingForTest('req-stuck', fortyMinAgo);

      const snapshot = metrics.getSnapshot();
      expect(snapshot.activeRequests).toHaveLength(0);
      // and the entry is actually removed, not just hidden
      expect(metrics.getActiveDiagnostics().pendingNow).toBe(0);
    });

    it('should prune stale pendings via the periodic sweep timer', () => {
      vi.useFakeTimers();
      try {
        const metrics = new DashboardMetrics();
        metrics.processEntry({
          level: 'info',
          message: 'Request started',
          context: { requestId: 'req-swept', method: 'POST', url: '/api/v1/messages' },
        });
        metrics.agePendingForTest(
          'req-swept',
          new Date(Date.now() - 40 * 60 * 1000).toISOString()
        );
        metrics.startStaleSweep();
        vi.advanceTimersByTime(61 * 1000);
        metrics.stopStaleSweep();

        expect(metrics.getActiveDiagnostics().pendingNow).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should bound the pending map by evicting the oldest entry', () => {
      const metrics = new DashboardMetrics();
      // MAX_PENDING is 500; push 505 starts with no completions
      for (let i = 0; i < 505; i++) {
        metrics.processEntry({
          level: 'info',
          message: 'Request started',
          context: { requestId: `req-flood-${i}`, method: 'POST', url: '/api/v1/messages' },
        });
      }

      const active = metrics.getSnapshot().activeRequests;
      expect(active.length).toBeLessThanOrEqual(500);
    });

    it('should track prefixed proxy URLs with query strings (production traffic shape)', () => {
      // Production serves /api/v1/... and clients append ?beta=true — the
      // previous matcher missed both, leaving the active panel permanently
      // empty despite healthy traffic.
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-prefixed', method: 'POST', url: '/api/v1/messages?beta=true' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-prefixed-oai', method: 'POST', url: '/api/v1/chat/completions' },
      });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.activeRequests).toHaveLength(2);
      const byId = Object.fromEntries(snapshot.activeRequests.map((r) => [r.requestId, r]));
      expect(byId['req-prefixed']!.format).toBe('anthropic');
      expect(byId['req-prefixed-oai']!.format).toBe('openai');
    });

    it('should not count count_tokens metering requests as active', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: {
          requestId: 'req-meter',
          method: 'POST',
          url: '/api/v1/messages/count_tokens?beta=true',
        },
      });

      expect(metrics.getSnapshot().activeRequests).toHaveLength(0);
      // …but format detection still classifies it for diagnostics
      expect(metrics.getActiveDiagnostics().pendingProxy).toBe(0);
    });

    it('should attach the requested model to the active row when the handler log arrives', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-model', method: 'POST', url: '/api/v1/messages?beta=true' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Anthropic message request',
        context: { requestId: 'req-model', model: 'k3', stream: true },
      });

      const active = metrics.getSnapshot().activeRequests[0]!;
      expect(active.model).toBe('k3');
    });

    it('should report pendingProxy in diagnostics separately from total pendings', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-proxy', method: 'POST', url: '/api/v1/messages?beta=true' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-dash', method: 'GET', url: '/api/dashboard/summary' },
      });

      const diag = metrics.getActiveDiagnostics();
      expect(diag.pendingNow).toBe(2);
      expect(diag.pendingProxy).toBe(1);
    });
  });

  describe('recent request buffer', () => {
    it('should record a recent request for proxy completions', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { keyName: 'claude-code' });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.recentRequests).toHaveLength(1);
      const row = snapshot.recentRequests[0]!;
      expect(row.apiKey).toBe('claude-code');
      expect(row.model).toBe('k3');
      expect(row.plan).toBe('Kimi-A');
      expect(row.format).toBe('openai');
      expect(row.totalTokens).toBe(150);
      expect(row.status).toBe(200);
    });

    it('should detect anthropic format from /v1/messages url', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { url: '/api/v1/messages' });

      const row = metrics.getSnapshot().recentRequests[0]!;
      expect(row.format).toBe('anthropic');
    });

    it('should keep canonicalModel on the row for rewritten models', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, {
        completion: {
          provider: {
            planId: 2,
            planName: 'Kimi-B',
            model: 'k3',
            canonicalModel: 'k3-256k',
            statusCode: 200,
          },
        },
      });

      const row = metrics.getSnapshot().recentRequests[0]!;
      expect(row.model).toBe('k3');
      expect(row.canonicalModel).toBe('k3-256k');
    });

    it('should record failed proxy requests with placeholder plan', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-x', method: 'POST', url: '/api/v1/chat/completions' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Request completed',
        context: { requestId: 'req-x', statusCode: 500, durationMs: 12 },
      });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.recentRequests).toHaveLength(1);
      const row = snapshot.recentRequests[0]!;
      expect(row.status).toBe(500);
      expect(row.plan).toBe('—');
      expect(row.apiKey).toBe('anonymous');
    });

    it('should ignore completions for non-proxy endpoints', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { url: '/api/v1/models' });

      expect(metrics.getSnapshot().recentRequests).toHaveLength(0);
    });

    it('should record the failure row once on completion after the error log', () => {
      const metrics = new DashboardMetrics();
      metrics.processEntry({
        level: 'info',
        message: 'Request started',
        context: { requestId: 'req-e1', method: 'POST', url: '/api/v1/messages' },
      });
      metrics.processEntry({
        level: 'info',
        message: 'Request authenticated',
        context: { requestId: 'req-e1', keyName: 'claude-code' },
      });
      // error path first (no row recorded)…
      metrics.processEntry({
        level: 'error',
        message: 'Request error',
        error: { name: 'Error', message: 'upstream 429' },
        context: {
          requestId: 'req-e1',
          method: 'POST',
          url: '/api/v1/messages',
          provider: { planId: 2, planName: 'Kimi K3', model: 'kimi-k3', statusCode: 0 },
        },
      });
      // …then the completion log with the final status and chain
      metrics.processEntry({
        level: 'info',
        message: 'Request completed',
        context: {
          requestId: 'req-e1',
          statusCode: 429,
          durationMs: 41,
          provider: { planId: 2, planName: 'Kimi K3', model: 'kimi-k3', statusCode: 0 },
        },
      });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.failedRequests).toBe(1);
      expect(snapshot.recentRequests).toHaveLength(1);
      const row = snapshot.recentRequests[0]!;
      expect(row.format).toBe('anthropic');
      expect(row.plan).toBe('Kimi K3');
      expect(row.model).toBe('kimi-k3');
      expect(row.apiKey).toBe('claude-code');
      // upstream never responded (0) → falls back to gateway status
      expect(row.status).toBe(429);
    });

    it('should prefer the real upstream status over the gateway status', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, {
        completion: {
          statusCode: 502,
          provider: { planId: 1, planName: 'Zhipu', model: 'glm', statusCode: 429 },
        },
      });

      const row = metrics.getSnapshot().recentRequests[0]!;
      expect(row.status).toBe(429);
    });

    it('should cap the recent buffer at the max size, newest first', () => {
      const metrics = new DashboardMetrics();
      for (let i = 0; i < 210; i++) {
        pushRequest(metrics, { requestId: `req-${i}` });
      }

      const rows = metrics.getSnapshot().recentRequests;
      expect(rows).toHaveLength(200);
      // newest first
      expect(rows[0]!.at >= rows[rows.length - 1]!.at).toBe(true);
    });

    it('should accumulate per-key / per-model / per-plan usage on success', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { keyName: 'key-a' });
      pushRequest(metrics, { requestId: 'req-2', keyName: 'key-a' });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.apiKeyUsages['key-a']).toEqual({ requests: 2, tokens: 300 });
      expect(snapshot.modelUsages['k3']).toEqual({ requests: 2, tokens: 300 });
      expect(snapshot.planUsages['Kimi-A']).toEqual({ requests: 2, tokens: 300 });
    });
  });

  describe('buildPlanQuotaRows', () => {
    it('should produce a balance row for providers with an account balance', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('DeepSeek-A', {
        windows: [],
        summary: { mode: 'balance', value: '¥42.50' },
        lastUpdated: '2026-08-04T10:00:00.000Z',
      }, 'deepseek');

      const rows = metrics.buildPlanQuotaRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        planName: 'DeepSeek-A',
        providerId: 'deepseek',
        kind: 'balance',
        balance: '¥42.50',
      });
    });

    it('should produce a usage-api row with the max window percentage', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('Kimi-A', {
        windows: [
          { type: '5h', percentage: 35, windowLabel: '5h' },
          { type: 'weekly', percentage: 62, windowLabel: '1w' },
        ],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      }, 'kimi');

      const rows = metrics.buildPlanQuotaRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.kind).toBe('usage-api');
      expect(row.percentage).toBe(62);
      expect(row.windows).toHaveLength(2);
    });

    it('should produce a local-quota row with only the reset time', () => {
      const metrics = new DashboardMetrics();
      metrics.setLocalQuota('Local-A', {
        percentage: 25,
        resetAt: '2026-08-05T00:00:00.000Z',
        limit: 1000,
        used: 250,
      });

      const rows = metrics.buildPlanQuotaRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.planName).toBe('Local-A');
      expect(row.kind).toBe('local-quota');
      expect(row.resetAt).toBe('2026-08-05T00:00:00.000Z');
      // no remaining figure / progress bar data for local-quota rows
      expect(row.remaining).toBeUndefined();
      expect(row.limit).toBeUndefined();
      expect(row.percentage).toBeUndefined();
    });

    it('should omit plans without any accurate remaining signal', () => {
      const metrics = new DashboardMetrics();
      // usage-API plan whose fetch produced no windows and no balance
      metrics.setProviderUsage('Broken-Usage-Plan', {
        windows: [],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      });
      // local plan with no finite limit (unlimited / not configured)
      metrics.setLocalQuota('Unlimited-Plan', {
        percentage: 0,
        resetAt: null,
        limit: 0,
        used: 0,
      });

      expect(metrics.buildPlanQuotaRows()).toHaveLength(0);
    });

    it('should prefer the usage-API row over the local-quota row for the same plan', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('Dual', {
        windows: [{ type: '5h', percentage: 10, windowLabel: '5h' }],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      });
      metrics.setLocalQuota('Dual', {
        percentage: 50,
        resetAt: null,
        limit: 100,
        used: 50,
      });

      const rows = metrics.buildPlanQuotaRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe('usage-api');
    });

    it('should order rows: balances first, then usage-api by consumption, then local-quota', () => {
      const metrics = new DashboardMetrics();
      metrics.setLocalQuota('Local-First', {
        percentage: 10,
        resetAt: null,
        limit: 100,
        used: 10,
      });
      metrics.setProviderUsage('Kimi-Low', {
        windows: [{ type: '5h', percentage: 20, windowLabel: '5h' }],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      });
      metrics.setProviderUsage('DeepSeek-Balance', {
        windows: [],
        summary: { mode: 'balance', value: '¥10.00' },
        lastUpdated: '2026-08-04T10:00:00.000Z',
      });
      metrics.setProviderUsage('Zhipu-High', {
        windows: [{ type: '5h', percentage: 80, windowLabel: '5h' }],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      });

      const rows = metrics.buildPlanQuotaRows();
      expect(rows.map((r) => r.planName)).toEqual([
        'DeepSeek-Balance', // balance always first
        'Zhipu-High', // usage-api rows sorted by consumption desc
        'Kimi-Low',
        'Local-First', // local-quota last
      ]);
    });

    it('should derive window durationMs from the window label for the time axis', () => {
      const metrics = new DashboardMetrics();
      metrics.setProviderUsage('Kimi-A', {
        windows: [
          { type: '5h', percentage: 35, windowLabel: '5h', nextResetTime: 1785840000000 },
          { type: 'weekly', percentage: 62, windowLabel: '1w', nextResetTime: 1786200000000 },
        ],
        lastUpdated: '2026-08-04T10:00:00.000Z',
      }, 'kimi');

      const row = metrics.buildPlanQuotaRows()[0]!;
      const byLabel = Object.fromEntries(row.windows!.map((w) => [w.windowLabel, w]));
      expect(byLabel['5h']!.durationMs).toBe(5 * 3_600_000);
      expect(byLabel['1w']!.durationMs).toBe(7 * 24 * 3_600_000);
      // timestamps pass through untouched so the UI can render reset times
      expect(byLabel['1w']!.nextResetTime).toBe(1786200000000);
    });

    it('should carry period info on local-quota rows for the cycle time axis', () => {
      const metrics = new DashboardMetrics();
      metrics.setLocalQuota('Local-Weekly', {
        percentage: 25,
        resetAt: '2026-08-10T00:00:00.000Z',
        periodType: 'weekly',
        limit: 1000,
        used: 250,
      });

      const row = metrics.buildPlanQuotaRows()[0]!;
      expect(row.periodType).toBe('weekly');
      expect(row.windowHours).toBeUndefined();
      expect(row.resetAt).toBe('2026-08-10T00:00:00.000Z');
    });
  });

  describe('windowDurationMs', () => {
    it('should parse short window labels into milliseconds', () => {
      expect(windowDurationMs('5h')).toBe(5 * 3_600_000);
      expect(windowDurationMs('1w')).toBe(7 * 24 * 3_600_000);
      expect(windowDurationMs('7d')).toBe(7 * 24 * 3_600_000);
      expect(windowDurationMs('1m')).toBe(30 * 24 * 3_600_000);
    });

    it('should return undefined for unknown or missing labels', () => {
      expect(windowDurationMs(undefined)).toBeUndefined();
      expect(windowDurationMs('rolling')).toBeUndefined();
      expect(windowDurationMs('')).toBeUndefined();
    });
  });
});

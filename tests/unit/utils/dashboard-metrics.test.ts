/**
 * Unit tests for DashboardMetrics utility.
 * Tests Usage API reset time extraction for plan selection.
 */

import { describe, it, expect } from 'vitest';
import { DashboardMetrics, type ProviderUsageSnapshot } from '@/utils/dashboard-metrics';

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

  describe('processEntry flow chains', () => {
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

    it('should record a flow chain for proxy completions', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { keyName: 'claude-code' });

      const snapshot = metrics.getSnapshot();
      expect(snapshot.flows).toHaveLength(1);
      const flow = snapshot.flows[0]!;
      expect(flow.apiKey).toBe('claude-code');
      expect(flow.model).toBe('k3');
      expect(flow.plan).toBe('Kimi-A');
      expect(flow.format).toBe('openai');
      expect(flow.totalTokens).toBe(150);
      expect(flow.status).toBe(200);
    });

    it('should detect anthropic format from /v1/messages url', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { url: '/api/v1/messages' });

      const flow = metrics.getSnapshot().flows[0]!;
      expect(flow.format).toBe('anthropic');
    });

    it('should keep canonicalModel on the flow chain for rewritten models', () => {
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

      const flow = metrics.getSnapshot().flows[0]!;
      expect(flow.model).toBe('k3');
      expect(flow.canonicalModel).toBe('k3-256k');
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
      expect(snapshot.flows).toHaveLength(1);
      const flow = snapshot.flows[0]!;
      expect(flow.status).toBe(500);
      expect(flow.plan).toBe('—');
      expect(flow.apiKey).toBe('anonymous');
    });

    it('should ignore completions for non-proxy endpoints', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, { url: '/api/v1/models' });

      expect(metrics.getSnapshot().flows).toHaveLength(0);
    });

    it('should record the failure flow once on completion after the error log', () => {
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
      // error path first (no flow recorded)…
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
      expect(snapshot.flows).toHaveLength(1);
      const flow = snapshot.flows[0]!;
      expect(flow.format).toBe('anthropic');
      expect(flow.plan).toBe('Kimi K3');
      expect(flow.model).toBe('kimi-k3');
      expect(flow.apiKey).toBe('claude-code');
      // upstream never responded (0) → falls back to gateway status
      expect(flow.status).toBe(429);
    });

    it('should prefer the real upstream status over the gateway status', () => {
      const metrics = new DashboardMetrics();
      pushRequest(metrics, {
        completion: {
          statusCode: 502,
          provider: { planId: 1, planName: 'Zhipu', model: 'glm', statusCode: 429 },
        },
      });

      const flow = metrics.getSnapshot().flows[0]!;
      expect(flow.status).toBe(429);
    });

    it('should cap the flow buffer at the max size', () => {
      const metrics = new DashboardMetrics();
      for (let i = 0; i < 510; i++) {
        pushRequest(metrics, { requestId: `req-${i}` });
      }

      const flows = metrics.getSnapshot().flows;
      expect(flows).toHaveLength(500);
      // newest first
      expect(flows[0]!.at >= flows[flows.length - 1]!.at).toBe(true);
    });
  });
});

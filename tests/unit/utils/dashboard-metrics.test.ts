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
  });
});
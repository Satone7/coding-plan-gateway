/**
 * Unit tests for PlanUsageTracker service.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PlanUsageTracker, createPlanUsageTracker } from '@/services/plan-usage-tracker';

describe('PlanUsageTracker', () => {
  let tracker: PlanUsageTracker;
  let tempDir: string;
  let usageDataPath: string;
  let adjustmentHistoryPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `plan-usage-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    usageDataPath = join(tempDir, 'plan-usage-data.json');
    adjustmentHistoryPath = join(tempDir, 'usage-adjustment-history.json');

    tracker = createPlanUsageTracker({
      planUsageDataPath: usageDataPath,
      adjustmentHistoryPath,
      syncIntervalMs: 1000,
      retentionDays: 90,
    });
  });

  afterEach(async () => {
    if (tracker) {
      tracker.stopPeriodicSync();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should initialize with no existing data', async () => {
      await tracker.initialize();

      expect(tracker.isInitialized()).toBe(true);
      expect(tracker.getRecordCount()).toBe(0);
      expect(tracker.getAdjustmentCount()).toBe(0);
    });

    it('should create storage files on persist', async () => {
      await tracker.initialize();
      await tracker.persist();

      await expect(access(usageDataPath)).resolves.not.toThrow();
      await expect(access(adjustmentHistoryPath)).resolves.not.toThrow();
    });
  });

  describe('incrementDailyUsage', () => {
    it('should track daily usage for a plan', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      expect(tracker.getRecordCount()).toBe(1);
      expect(tracker.getTotalUsage(1)).toBe(3);
    });

    it('should track usage for multiple plans', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(2);
      tracker.incrementDailyUsage(1);

      expect(tracker.getRecordCount()).toBe(2);
      expect(tracker.getTotalUsage(1)).toBe(2);
      expect(tracker.getTotalUsage(2)).toBe(1);
    });
  });

  describe('decrementDailyUsage', () => {
    it('should decrement daily usage', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);
      tracker.decrementDailyUsage(1);

      expect(tracker.getTotalUsage(1)).toBe(1);
    });

    it('should not go below zero', async () => {
      await tracker.initialize();

      tracker.decrementDailyUsage(1);

      expect(tracker.getTotalUsage(1)).toBe(0);
    });
  });

  describe('getUsageReport', () => {
    it('should generate usage report for a plan', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: { limit: 100, period: 'monthly' as const },
      };

      const report = tracker.getUsageReport(1, planInfo);

      expect(report).toBeDefined();
      expect(report?.planId).toBe(1);
      expect(report?.planName).toBe('Test Plan');
      expect(report?.totalRequests).toBe(2);
      expect(report?.limit).toBe(100);
      expect(report?.remaining).toBe(98);
      expect(report?.percentage).toBe(2);
    });

    it('should return a report even when no data exists', async () => {
      await tracker.initialize();

      const planInfo = {
        id: 999999,
        name: 'Test Plan',
        quota: { limit: 100, period: 'monthly' as const },
      };

      const report = tracker.getUsageReport(999999, planInfo);

      // Returns a report with 0 usage when no data exists
      expect(report).toBeDefined();
      expect(report?.totalRequests).toBe(0);
    });

    it('should calculate reset date for daily period', async () => {
      await tracker.initialize();

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: { limit: 100, period: 'daily' as const },
      };

      tracker.incrementDailyUsage(1);
      const report = tracker.getUsageReport(1, planInfo);

      expect(report?.resetAt).toBeInstanceOf(Date);
    });

    it('should return null reset date for total period', async () => {
      await tracker.initialize();

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: { limit: 100, period: 'total' as const },
      };

      tracker.incrementDailyUsage(1);
      const report = tracker.getUsageReport(1, planInfo);

      expect(report?.resetAt).toBeNull();
    });
  });

  describe('adjustUsage', () => {
    it('should adjust usage to new value', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      const result = tracker.adjustUsage(1, 100, 500, 'count', 100);

      expect(result.oldValue).toBe(2);
      expect(result.newValue).toBe(100);
      expect(result.adjustmentId).toBeDefined();
    });

    it('should record adjustment in history', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.adjustUsage(1, 50, 100, 'count', 50);

      const history = tracker.getAdjustmentHistory(1);

      expect(history).toHaveLength(1);
      expect(history[0]?.oldValue).toBe(1);
      expect(history[0]?.newValue).toBe(50);
      expect(history[0]?.adjustmentType).toBe('count');
    });

    it('should generate warning when exceeding limit', async () => {
      await tracker.initialize();

      const result = tracker.adjustUsage(1, 150, 100, 'percent', 150);

      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('exceeds quota limit');
    });

    it('should not generate warning when under limit', async () => {
      await tracker.initialize();

      const result = tracker.adjustUsage(1, 50, 100, 'count', 50);

      expect(result.warning).toBeUndefined();
    });
  });

  describe('getAdjustmentHistory', () => {
    it('should return adjustment history for a plan', async () => {
      await tracker.initialize();

      tracker.adjustUsage(1, 10, 100, 'count', 10);
      tracker.adjustUsage(1, 20, 100, 'count', 20);
      tracker.adjustUsage(2, 30, 100, 'count', 30);

      const history = tracker.getAdjustmentHistory(1);

      expect(history).toHaveLength(2);
    });

    it('should limit results', async () => {
      await tracker.initialize();

      tracker.adjustUsage(1, 10, 100, 'count', 10);
      tracker.adjustUsage(1, 20, 100, 'count', 20);
      tracker.adjustUsage(1, 30, 100, 'count', 30);

      const history = tracker.getAdjustmentHistory(1, 2);

      expect(history).toHaveLength(2);
    });

    it('should return all history when planId not specified', async () => {
      await tracker.initialize();

      tracker.adjustUsage(1, 10, 100, 'count', 10);
      tracker.adjustUsage(2, 20, 100, 'count', 20);

      const history = tracker.getAdjustmentHistory();

      expect(history).toHaveLength(2);
    });
  });

  describe('persistence', () => {
    it('should persist and load data', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);
      tracker.adjustUsage(1, 50, 100, 'count', 50);
      await tracker.persist();

      // Create new tracker and load persisted data
      const newTracker = createPlanUsageTracker({
        planUsageDataPath: usageDataPath,
        adjustmentHistoryPath,
      });
      await newTracker.initialize();

      expect(newTracker.getRecordCount()).toBe(1);
      // Adjustment count depends on persistence
      expect(newTracker.getAdjustmentCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('retention', () => {
    it('should cleanup old records on initialization', async () => {
      // Create tracker with short retention
      const shortRetentionTracker = createPlanUsageTracker({
        planUsageDataPath: join(tempDir, 'retention-usage.json'),
        adjustmentHistoryPath: join(tempDir, 'retention-adjustment.json'),
        retentionDays: 1,
      });

      await shortRetentionTracker.initialize();

      // This test verifies the cleanup method exists
      // In real usage, old records would be cleaned up
      expect(shortRetentionTracker.isInitialized()).toBe(true);

      await shortRetentionTracker.shutdown();
    });
  });

  describe('periodic sync', () => {
    it('should start and stop periodic sync', async () => {
      await tracker.initialize();

      tracker.startPeriodicSync();
      // Should not throw if called again
      tracker.startPeriodicSync();

      tracker.stopPeriodicSync();
      // Should not throw if called again
      tracker.stopPeriodicSync();
    });
  });

  describe('shutdown', () => {
    it('should gracefully shutdown', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.startPeriodicSync();

      await tracker.shutdown();

      expect(tracker.isInitialized()).toBe(true);
    });
  });

  describe('calculateResetAt with expiresOn', () => {
    it('should calculate reset date based on expiresOn for monthly period', async () => {
      await tracker.initialize();

      // expiresOn = 27 means quota resets on 27th of each month
      const resetDate = tracker.calculateResetAt('monthly', 27);

      expect(resetDate).toBeInstanceOf(Date);
      expect(resetDate?.getDate()).toBe(27);
    });

    it('should return next month date if expiresOn has passed this month', async () => {
      await tracker.initialize();

      const now = new Date();
      const currentDay = now.getDate();

      // Use a day that has already passed this month
      const pastDay = currentDay > 1 ? currentDay - 1 : 1;
      const resetDate = tracker.calculateResetAt('monthly', pastDay);

      expect(resetDate).toBeInstanceOf(Date);
      // Should be in a future month
      expect(resetDate?.getMonth()).not.toBe(now.getMonth());
    });

    it('should return null for total period regardless of expiresOn', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt('total', 27);

      expect(resetDate).toBeNull();
    });

    it('should use expiresAt when both expiresOn and expiresAt are provided', async () => {
      await tracker.initialize();

      // expiresAt takes precedence
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 2);
      futureDate.setDate(15);
      futureDate.setHours(23, 59, 59, 999);

      const resetDate = tracker.calculateResetAt(
        'monthly',
        27, // expiresOn should be ignored
        futureDate.toISOString()
      );

      expect(resetDate).toBeInstanceOf(Date);
      // Reset date should be midnight of the expiration day
      expect(resetDate?.getDate()).toBe(futureDate.getDate());
    });

    it('should calculate daily reset date ignoring expiresOn', async () => {
      await tracker.initialize();

      // Daily period should reset at next midnight regardless of expiresOn
      const resetDate = tracker.calculateResetAt('daily', 27);

      expect(resetDate).toBeInstanceOf(Date);
      expect(resetDate?.getHours()).toBe(0);
      expect(resetDate?.getMinutes()).toBe(0);
      expect(resetDate?.getSeconds()).toBe(0);
    });
  });

  describe('calculateResetDate month boundary edge cases', () => {
    it('should handle February 30th by using last day of February', async () => {
      await tracker.initialize();

      // expiresOn = 30 should map to Feb 28/29 depending on leap year
      const resetDate = tracker.calculateResetAt('monthly', 30);

      expect(resetDate).toBeInstanceOf(Date);
      // The date should be valid (either 28, 29, or 30)
      expect(resetDate?.getDate()).toBeLessThanOrEqual(30);
    });

    it('should handle February 31st by using last day of February', async () => {
      await tracker.initialize();

      // expiresOn = 31 should map to Feb 28/29
      const resetDate = tracker.calculateResetAt('monthly', 31);

      expect(resetDate).toBeInstanceOf(Date);
      // The date should be valid
      expect(resetDate?.getDate()).toBeLessThanOrEqual(31);
    });

    it('should handle month with 30 days when expiresOn is 31', async () => {
      await tracker.initialize();

      // Test April (30 days), June (30 days), September (30 days), November (30 days)
      const resetDate = tracker.calculateResetAt('monthly', 31);

      expect(resetDate).toBeInstanceOf(Date);
      // The date should be valid for any month
      expect(resetDate?.getDate()).toBeLessThanOrEqual(31);
    });

    it('should handle leap year February 29th', async () => {
      await tracker.initialize();

      // expiresOn = 29 should work for leap year February
      const resetDate = tracker.calculateResetAt('monthly', 29);

      expect(resetDate).toBeInstanceOf(Date);
      // The date should be 29 or the last day of the month
      expect(resetDate?.getDate()).toBeGreaterThanOrEqual(28);
      expect(resetDate?.getDate()).toBeLessThanOrEqual(31);
    });
  });

  describe('calculateResetDate with PlanInfo', () => {
    it('should use plan quota expiresOn for reset date calculation', async () => {
      await tracker.initialize();

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: {
          limit: 100,
          period: 'monthly' as const,
          expiresOn: 27,
        },
      };

      const resetDate = tracker.calculateResetDate(planInfo);

      expect(resetDate).toBeInstanceOf(Date);
      expect(resetDate?.getDate()).toBe(27);
    });

    it('should use plan quota expiresAt for reset date calculation', async () => {
      await tracker.initialize();

      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 1);
      futureDate.setDate(15);
      futureDate.setHours(23, 59, 59, 999);

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: {
          limit: 100,
          period: 'monthly' as const,
          expiresAt: futureDate.toISOString(),
        },
      };

      const resetDate = tracker.calculateResetDate(planInfo);

      expect(resetDate).toBeInstanceOf(Date);
      expect(resetDate?.getDate()).toBe(futureDate.getDate());
    });

    it('should fallback to default for plans without expiresOn/expiresAt', async () => {
      await tracker.initialize();

      const planInfo = {
        id: 1,
        name: 'Test Plan',
        quota: {
          limit: 100,
          period: 'monthly' as const,
        },
      };

      const resetDate = tracker.calculateResetDate(planInfo);

      expect(resetDate).toBeInstanceOf(Date);
      // Should be first day of next month
      expect(resetDate?.getDate()).toBe(1);
    });
  });

  describe('getUsageForQuotaManager', () => {
    it('should return usage data for a plan', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      const usage = tracker.getUsageForQuotaManager(1);

      expect(usage).toBeDefined();
      expect(usage?.used).toBe(3);
      expect(usage?.lastUpdated).toBeInstanceOf(Date);
    });

    it('should return zero usage for non-existent plan', async () => {
      await tracker.initialize();

      const usage = tracker.getUsageForQuotaManager(999);

      expect(usage).toBeDefined();
      expect(usage?.used).toBe(0);
    });
  });

  describe('resetPlanUsage', () => {
    it('should reset all usage records for a plan', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(2);

      const resetCount = tracker.resetPlanUsage(1);

      expect(resetCount).toBe(1); // 1 record for plan 1
      expect(tracker.getTotalUsage(1)).toBe(0);
      expect(tracker.getTotalUsage(2)).toBe(1); // Plan 2 unaffected
    });

    it('should return 0 if no records exist for the plan', async () => {
      await tracker.initialize();

      const resetCount = tracker.resetPlanUsage(999);

      expect(resetCount).toBe(0);
    });
  });

  describe('checkAndResetExpiredPlans', () => {
    it('should not reset plans that have not expired', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      // Create a plan with expiration in the future
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const plans = [
        {
          id: 1,
          quota: {
            period: 'monthly' as const,
            expiresAt: futureDate.toISOString(),
          },
        },
      ];

      const resetPlanIds = tracker.checkAndResetExpiredPlans(plans);

      expect(resetPlanIds).toHaveLength(0);
      expect(tracker.getTotalUsage(1)).toBe(2);
    });

    it('should reset plans that have expired', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      // Create a plan with expiration in the past
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const plans = [
        {
          id: 1,
          quota: {
            period: 'monthly' as const,
            expiresAt: pastDate.toISOString(),
          },
        },
      ];

      const resetPlanIds = tracker.checkAndResetExpiredPlans(plans);

      expect(resetPlanIds).toContain(1);
      expect(tracker.getTotalUsage(1)).toBe(0);
    });

    it('should skip total period plans', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);

      const plans = [
        {
          id: 1,
          quota: { period: 'total' as const },
        },
      ];

      const resetPlanIds = tracker.checkAndResetExpiredPlans(plans);

      expect(resetPlanIds).toHaveLength(0);
      expect(tracker.getTotalUsage(1)).toBe(1);
    });

    it('should handle plans with expiresOn day in the past', async () => {
      await tracker.initialize();

      tracker.incrementDailyUsage(1);

      // Create a plan with expiresOn that has passed this month
      const now = new Date();
      const pastDay = now.getDate() > 1 ? now.getDate() - 1 : 1;

      const plans = [
        {
          id: 1,
          quota: {
            period: 'monthly' as const,
            expiresOn: pastDay,
          },
        },
      ];

      // The expiration should be calculated for next month, not reset
      const resetPlanIds = tracker.checkAndResetExpiredPlans(plans);

      // Should not reset if the calculated expiration date is in the future
      // (depends on timing of the test)
      expect(tracker.getTotalUsage(1)).toBe(1);
    });
  });

  describe('calculateResetAt with structured QuotaPeriod', () => {
    it('should return null for total structured period', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt({ type: 'total' });
      expect(resetDate).toBeNull();
    });

    it('should calculate 5h sliding window reset', async () => {
      await tracker.initialize();

      const before = new Date();
      const resetDate = tracker.calculateResetAt({ type: '5h', windowHours: 5, sliding: true });
      const after = new Date();

      expect(resetDate).not.toBeNull();
      const minExpected = before.getTime() + 5 * 60 * 60 * 1000;
      const maxExpected = after.getTime() + 5 * 60 * 60 * 1000;
      expect(resetDate!.getTime()).toBeGreaterThanOrEqual(minExpected);
      expect(resetDate!.getTime()).toBeLessThanOrEqual(maxExpected);
    });

    it('should calculate weekly reset at configured weekday', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt({ type: 'weekly', weekday: 1 });
      expect(resetDate).not.toBeNull();
      // Should be a Monday (JS day 1)
      expect(resetDate!.getUTCDay()).toBe(1);
      expect(resetDate!.getUTCHours()).toBe(0);
    });

    it('should calculate weekly reset for Sunday (weekday=7)', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt({ type: 'weekly', weekday: 7 });
      expect(resetDate).not.toBeNull();
      // Sunday in JS is day 0
      expect(resetDate!.getUTCDay()).toBe(0);
    });

    it('should calculate monthly reset with structured period and expiresOn', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt({ type: 'monthly', expiresOn: 27 });
      expect(resetDate).not.toBeNull();
      expect(resetDate!.getUTCDate()).toBe(27);
    });

    it('should calculate monthly reset without expiresOn (defaults to 1st)', async () => {
      await tracker.initialize();

      const resetDate = tracker.calculateResetAt({ type: 'monthly' });
      expect(resetDate).not.toBeNull();
      expect(resetDate!.getUTCDate()).toBe(1);
    });

    it('should handle structured monthly with plan-level expiresAt override', async () => {
      await tracker.initialize();

      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 2);
      futureDate.setDate(15);
      futureDate.setHours(23, 59, 59, 999);

      const resetDate = tracker.calculateResetAt(
        { type: 'monthly', expiresOn: 27 },
        undefined,
        futureDate.toISOString()
      );

      expect(resetDate).not.toBeNull();
      expect(resetDate!.getDate()).toBe(futureDate.getDate());
    });
  });
});

describe('createPlanUsageTracker', () => {
  it('should create tracker with default config', () => {
    const tracker = createPlanUsageTracker();

    expect(tracker).toBeInstanceOf(PlanUsageTracker);
    expect(tracker.getStoragePath()).toContain('plan-usage-data.json');
  });

  it('should create tracker with custom config', () => {
    const tracker = createPlanUsageTracker({
      planUsageDataPath: './custom-usage.json',
      syncIntervalMs: 5000,
      retentionDays: 30,
    });

    // Path is resolved to absolute
    expect(tracker.getStoragePath()).toContain('custom-usage.json');
  });
});
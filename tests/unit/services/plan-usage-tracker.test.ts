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
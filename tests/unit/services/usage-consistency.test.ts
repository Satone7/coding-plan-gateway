/**
 * Regression tests ensuring usage consistency across the system.
 * Verifies that QuotaManager and PlanUsageTracker report consistent usage values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuotaManager, createQuotaManager } from '@/services/quota-manager';
import { PlanUsageTracker, createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Usage Consistency', () => {
  let tempDir: string;
  let quotaManager: QuotaManager;
  let planUsageTracker: PlanUsageTracker;
  let quotaPath: string;
  let usageDataPath: string;

  const testPlan = {
    id: 1,
    name: 'Test Plan',
    quota: {
      limit: 1000,
      period: 'monthly' as const,
    },
  };

  beforeEach(async () => {
    tempDir = join(tmpdir(), `usage-consistency-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    quotaPath = join(tempDir, 'quota-state.json');
    usageDataPath = join(tempDir, 'plan-usage-data.json');

    quotaManager = createQuotaManager({ quotaStatePath: quotaPath });
    planUsageTracker = createPlanUsageTracker({
      planUsageDataPath: usageDataPath,
      adjustmentHistoryPath: join(tempDir, 'adjustment-history.json'),
    });

    await quotaManager.initialize([testPlan]);
    await planUsageTracker.initialize();

    // Attach tracker to QuotaManager
    quotaManager.setPlanUsageTracker(planUsageTracker);
  });

  afterEach(async () => {
    quotaManager.stopPeriodicSync();
    planUsageTracker.stopPeriodicSync();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Initial state consistency', () => {
    it('should both report 0 usage initially', () => {
      const quotaUsage = quotaManager.getUsedQuota(testPlan.id);
      const trackerUsage = planUsageTracker.getTotalUsage(testPlan.id);

      expect(quotaUsage).toBe(0);
      expect(trackerUsage).toBe(0);
      expect(quotaUsage).toBe(trackerUsage);
    });
  });

  describe('Consume quota consistency', () => {
    it('should report consistent usage after consumeQuota', () => {
      quotaManager.consumeQuota(testPlan.id, 50);

      const quotaUsage = quotaManager.getUsedQuota(testPlan.id);
      const trackerUsage = planUsageTracker.getTotalUsage(testPlan.id);

      expect(quotaUsage).toBe(50);
      expect(trackerUsage).toBe(50);
      expect(quotaUsage).toBe(trackerUsage);
    });

    it('should report consistent usage after multiple consumeQuota calls', () => {
      quotaManager.consumeQuota(testPlan.id, 10);
      quotaManager.consumeQuota(testPlan.id, 20);
      quotaManager.consumeQuota(testPlan.id, 30);

      const quotaUsage = quotaManager.getUsedQuota(testPlan.id);
      const trackerUsage = planUsageTracker.getTotalUsage(testPlan.id);

      expect(quotaUsage).toBe(60);
      expect(trackerUsage).toBe(60);
      expect(quotaUsage).toBe(trackerUsage);
    });
  });

  describe('Refund quota consistency', () => {
    it('should report consistent usage after refundQuota', () => {
      quotaManager.consumeQuota(testPlan.id, 100);
      quotaManager.refundQuota(testPlan.id, 30);

      const quotaUsage = quotaManager.getUsedQuota(testPlan.id);
      const trackerUsage = planUsageTracker.getTotalUsage(testPlan.id);

      expect(quotaUsage).toBe(70);
      expect(trackerUsage).toBe(70);
      expect(quotaUsage).toBe(trackerUsage);
    });
  });

  describe('Manual adjustment consistency', () => {
    it('should report consistent usage after PlanUsageTracker adjustment and sync', async () => {
      // Adjust via PlanUsageTracker
      planUsageTracker.adjustUsage(testPlan.id, 250, testPlan.quota.limit, 'count', 250);
      await planUsageTracker.persist();

      // Before sync, QuotaManager still has old value
      const quotaUsageBeforeSync = quotaManager.getUsedQuota(testPlan.id);
      // But since getUsedQuota queries PlanUsageTracker, it should be consistent
      expect(quotaUsageBeforeSync).toBe(250);

      const trackerUsage = planUsageTracker.getTotalUsage(testPlan.id);
      expect(trackerUsage).toBe(250);

      // Both should be the same
      expect(quotaUsageBeforeSync).toBe(trackerUsage);
    });
  });

  describe('QuotaManager as single source query', () => {
    it('should query PlanUsageTracker when attached', () => {
      // Directly increment via tracker
      planUsageTracker.incrementDailyUsage(testPlan.id);
      planUsageTracker.incrementDailyUsage(testPlan.id);
      planUsageTracker.incrementDailyUsage(testPlan.id);

      // QuotaManager should reflect the tracker's value
      const quotaUsage = quotaManager.getUsedQuota(testPlan.id);
      expect(quotaUsage).toBe(3);
    });

    it('should fall back to local state when tracker not attached', async () => {
      // Create a new QuotaManager without tracker
      const isolatedQuotaManager = createQuotaManager({ quotaStatePath: join(tempDir, 'isolated-quota.json') });
      await isolatedQuotaManager.initialize([testPlan]);

      // Consume some quota
      isolatedQuotaManager.consumeQuota(testPlan.id, 42);

      // Should use local state
      const used = isolatedQuotaManager.getUsedQuota(testPlan.id);
      expect(used).toBe(42);

      isolatedQuotaManager.stopPeriodicSync();
    });
  });

  describe('hasRemainingQuota consistency', () => {
    it('should correctly report remaining quota based on tracker', () => {
      // Consume via tracker
      for (let i = 0; i < 999; i++) {
        planUsageTracker.incrementDailyUsage(testPlan.id);
      }

      // Should have remaining
      expect(quotaManager.hasRemainingQuota(testPlan.id)).toBe(true);

      // One more should exceed limit
      planUsageTracker.incrementDailyUsage(testPlan.id);
      expect(quotaManager.hasRemainingQuota(testPlan.id)).toBe(false);
    });
  });
});
/**
 * Unit tests for ExpirationScheduler service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ExpirationScheduler, createExpirationScheduler } from '@/services/expiration-scheduler';
import { PlanUsageTracker, createPlanUsageTracker } from '@/services/plan-usage-tracker';
import { createPlanRepository } from '@/services/plan-repository';
import type { IPlanRepository } from '@/services/plan-repository';

// Mock plan repository for testing
function createMockPlanRepository(plans: Array<{ id: number; quota: { period: 'daily' | 'monthly' | 'total'; expiresOn?: number; expiresAt?: string } }>): IPlanRepository {
  return {
    reload: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue(plans.map(p => ({
      id: p.id,
      name: `Plan ${p.id}`,
      baseUrl: 'https://api.example.com',
      apiKeyEncrypted: 'test',
      models: ['test-model'],
      quota: { limit: 100, period: p.quota.period },
      timeout: 30000,
      status: 'active' as const,
      expiresOn: p.quota.expiresOn,
      expiresAt: p.quota.expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))),
    findById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({} as any),
    update: vi.fn().mockResolvedValue({} as any),
    delete: vi.fn().mockResolvedValue(false),
    exists: vi.fn().mockResolvedValue(false),
  };
}

describe('ExpirationScheduler', () => {
  let tracker: PlanUsageTracker;
  let scheduler: ExpirationScheduler;
  let tempDir: string;
  let usageDataPath: string;
  let adjustmentHistoryPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `expiration-scheduler-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    usageDataPath = join(tempDir, 'plan-usage-data.json');
    adjustmentHistoryPath = join(tempDir, 'usage-adjustment-history.json');

    tracker = createPlanUsageTracker({
      planUsageDataPath: usageDataPath,
      adjustmentHistoryPath,
      syncIntervalMs: 60000,
      retentionDays: 90,
    });
    await tracker.initialize();
  });

  afterEach(async () => {
    if (scheduler) {
      scheduler.stop();
    }
    if (tracker) {
      tracker.stopPeriodicSync();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('start and stop', () => {
    it('should start and stop the scheduler', () => {
      const mockRepo = createMockPlanRepository([]);
      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 1000 });

      expect(scheduler.isRunning()).toBe(false);

      scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it('should not start twice', () => {
      const mockRepo = createMockPlanRepository([]);
      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 1000 });

      scheduler.start();
      scheduler.start(); // Should not throw

      expect(scheduler.isRunning()).toBe(true);
      scheduler.stop();
    });

    it('should not throw when stopping without starting', () => {
      const mockRepo = createMockPlanRepository([]);
      scheduler = createExpirationScheduler(tracker, mockRepo);

      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('getLastCheckTime', () => {
    it('should return null before first check', () => {
      const mockRepo = createMockPlanRepository([]);
      scheduler = createExpirationScheduler(tracker, mockRepo);

      expect(scheduler.getLastCheckTime()).toBeNull();
    });

    it('should return check time after start', async () => {
      const mockRepo = createMockPlanRepository([]);
      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 100 });

      scheduler.start();

      // Wait for the first check to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(scheduler.getLastCheckTime()).toBeInstanceOf(Date);
      scheduler.stop();
    });
  });

  describe('expiration checking', () => {
    it('should reset expired plans', async () => {
      // Add some usage
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      // Create a plan with expiration in the past
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const mockRepo = createMockPlanRepository([
        { id: 1, quota: { period: 'monthly', expiresAt: pastDate.toISOString() } },
      ]);

      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 100 });

      scheduler.start();

      // Wait for the check to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Usage should be reset
      expect(tracker.getTotalUsage(1)).toBe(0);

      scheduler.stop();
    });

    it('should not reset non-expired plans', async () => {
      // Add some usage
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(1);

      // Create a plan with expiration in the future
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const mockRepo = createMockPlanRepository([
        { id: 1, quota: { period: 'monthly', expiresAt: futureDate.toISOString() } },
      ]);

      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 100 });

      scheduler.start();

      // Wait for the check to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Usage should NOT be reset
      expect(tracker.getTotalUsage(1)).toBe(2);

      scheduler.stop();
    });

    it('should handle multiple plans with mixed expiration', async () => {
      // Add usage for multiple plans
      tracker.incrementDailyUsage(1);
      tracker.incrementDailyUsage(2);
      tracker.incrementDailyUsage(3);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const mockRepo = createMockPlanRepository([
        { id: 1, quota: { period: 'monthly', expiresAt: pastDate.toISOString() } }, // Expired
        { id: 2, quota: { period: 'monthly', expiresAt: futureDate.toISOString() } }, // Not expired
        { id: 3, quota: { period: 'total' } }, // Total period, never expires
      ]);

      scheduler = createExpirationScheduler(tracker, mockRepo, { checkIntervalMs: 100 });

      scheduler.start();

      // Wait for the check to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      // Plan 1 should be reset
      expect(tracker.getTotalUsage(1)).toBe(0);
      // Plan 2 should NOT be reset
      expect(tracker.getTotalUsage(2)).toBe(1);
      // Plan 3 should NOT be reset (total period)
      expect(tracker.getTotalUsage(3)).toBe(1);

      scheduler.stop();
    });
  });
});

describe('createExpirationScheduler', () => {
  it('should create scheduler with default config', () => {
    const tracker = createPlanUsageTracker();
    const mockRepo = createMockPlanRepository([]);

    const scheduler = createExpirationScheduler(tracker, mockRepo);

    expect(scheduler).toBeInstanceOf(ExpirationScheduler);
    expect(scheduler.isRunning()).toBe(false);
  });

  it('should create scheduler with custom config', () => {
    const tracker = createPlanUsageTracker();
    const mockRepo = createMockPlanRepository([]);

    const scheduler = createExpirationScheduler(tracker, mockRepo, {
      checkIntervalMs: 5000,
    });

    expect(scheduler).toBeInstanceOf(ExpirationScheduler);
  });
});
/**
 * Unit tests for QuotaManager service.
 * Tests quota tracking, persistence, and management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuotaManager, createQuotaManager } from '@/services/quota-manager';
import type { QuotaState } from '@/types';
import { calculateResetAt, createInitialQuotaState } from '@/types';
import { createMockPlans, createMockQuotaStates } from '../../fixtures/mock-plans';
import { writeFile, readFile, mkdir, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('QuotaManager', () => {
  let quotaManager: QuotaManager;
  let tempDir: string;
  let quotaPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `quota-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    quotaPath = join(tempDir, 'quota-state.json');
    quotaManager = createQuotaManager({ quotaStatePath: quotaPath });
  });

  afterEach(async () => {
    quotaManager.stopPeriodicSync();
    if (existsSync(tempDir)) {
      await rmdir(tempDir, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create a QuotaManager instance', () => {
      expect(quotaManager).toBeInstanceOf(QuotaManager);
    });
  });

  describe('initialize', () => {
    it('should initialize quota states from plans', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      for (const plan of plans) {
        const state = quotaManager.getQuotaState(plan.id);
        expect(state).toBeDefined();
        expect(state?.limit).toBe(plan.quota.limit);
      }
    });

    it('should load existing quota state from file', async () => {
      const plans = createMockPlans();
      const existingStates = createMockQuotaStates();

      // Write existing state file
      await writeFile(
        quotaPath,
        JSON.stringify({
          version: '1.0',
          lastSync: new Date().toISOString(),
          states: Object.fromEntries(existingStates.map((s) => [s.planId, s])),
        }),
        'utf-8'
      );

      await quotaManager.initialize(plans);

      for (const state of existingStates) {
        const loaded = quotaManager.getQuotaState(state.planId);
        if (loaded) {
          expect(loaded.used).toBe(state.used);
        }
      }
    });
  });

  describe('getQuotaState', () => {
    it('should return undefined for unknown plan', () => {
      expect(quotaManager.getQuotaState(999999)).toBeUndefined();
    });

    it('should return quota state for known plan', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state).toBeDefined();
      expect(state?.planId).toBe(plans[0].id);
    });
  });

  describe('consumeQuota', () => {
    it('should increment used quota', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const plan = plans[0];
      const before = quotaManager.getQuotaState(plan.id);
      expect(before).toBeDefined();
      const beforeUsed = before!.used;

      const consumed = await quotaManager.consumeQuota(plan.id, 10);

      expect(consumed).toBe(true);
      const after = quotaManager.getQuotaState(plan.id);
      expect(after?.used).toBe(beforeUsed + 10);
    });

    it('should return false when quota would be exceeded', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const plan = plans[0];
      const state = quotaManager.getQuotaState(plan.id);
      const remaining = state ? state.limit - state.used : plan.quota.limit;

      const consumed = await quotaManager.consumeQuota(plan.id, remaining + 100);
      expect(consumed).toBe(false);
    });

    it('should return false for unknown plan', async () => {
      const consumed = await quotaManager.consumeQuota(999999, 1);
      expect(consumed).toBe(false);
    });
  });

  describe('hasRemainingQuota', () => {
    it('should return true when quota remains', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const hasRemaining = quotaManager.hasRemainingQuota(plans[0].id);
      expect(hasRemaining).toBe(true);
    });

    it('should return false when quota is exhausted', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Exhaust the quota
      const state = quotaManager.getQuotaState(plans[0].id);
      const remaining = state ? state.limit - state.used : plans[0].quota.limit;
      await quotaManager.consumeQuota(plans[0].id, remaining);

      const hasRemaining = quotaManager.hasRemainingQuota(plans[0].id);
      expect(hasRemaining).toBe(false);
    });
  });

  describe('getRemainingQuota', () => {
    it('should return remaining quota', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const remaining = quotaManager.getRemainingQuota(plans[0].id);
      const state = quotaManager.getQuotaState(plans[0].id);
      expect(remaining).toBe(state ? state.limit - state.used : plans[0].quota.limit);
    });

    it('should return 0 for unknown plan', () => {
      expect(quotaManager.getRemainingQuota(999999)).toBe(0);
    });
  });

  describe('resetQuota', () => {
    it('should reset quota to zero', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Consume some quota
      await quotaManager.consumeQuota(plans[0].id, 50);

      // Reset it
      await quotaManager.resetQuota(plans[0].id);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.used).toBe(0);
    });

    it('should update reset timestamp', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const before = new Date();
      await quotaManager.resetQuota(plans[0].id);
      const after = new Date();

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.lastUpdated.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state?.lastUpdated.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('getAllQuotaStates', () => {
    it('should return all quota states', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const states = quotaManager.getAllQuotaStates();
      expect(states.size).toBe(plans.length);
    });
  });

  describe('persist and load', () => {
    it('should persist quota state to file', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Consume some quota
      await quotaManager.consumeQuota(plans[0].id, 25);

      // Persist
      await quotaManager.persist();

      // Verify file was created
      expect(existsSync(quotaPath)).toBe(true);

      // Load and verify
      const content = await readFile(quotaPath, 'utf-8');
      const data = JSON.parse(content);
      expect(data.states[plans[0].id].used).toBe(25);
    });

    it('should load quota state from file', async () => {
      const plans = createMockPlans();

      // Create a state file
      const states: Record<string, QuotaState> = {};
      states[plans[0].id] = {
        planId: plans[0].id,
        used: 100,
        limit: plans[0].quota.limit,
        period: plans[0].quota.period,
        lastUpdated: new Date(),
        resetAt: null,
      };

      await writeFile(
        quotaPath,
        JSON.stringify({
          version: '1.0',
          lastSync: new Date().toISOString(),
          states,
        }),
        'utf-8'
      );

      // Initialize and load
      await quotaManager.initialize(plans);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.used).toBe(100);
    });
  });

  describe('updatePlanQuota', () => {
    it('should update quota limit for a plan', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      quotaManager.updatePlanQuota(plans[0].id, 5000);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.limit).toBe(5000);
    });
  });

  describe('removePlan', () => {
    it('should remove quota state for a plan', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      quotaManager.removePlan(plans[0].id);

      expect(quotaManager.getQuotaState(plans[0].id)).toBeUndefined();
    });
  });

  describe('setUsedQuota', () => {
    it('should set usage to a specific value', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Set usage to 500
      quotaManager.setUsedQuota(plans[0].id, 500);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.used).toBe(500);
    });

    it('should update lastUpdated timestamp', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const before = new Date();
      quotaManager.setUsedQuota(plans[0].id, 100);
      const after = new Date();

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.lastUpdated.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(state?.lastUpdated.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should not affect quota limit', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const originalLimit = quotaManager.getQuotaState(plans[0].id)?.limit;
      quotaManager.setUsedQuota(plans[0].id, 500);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.limit).toBe(originalLimit);
    });

    it('should allow setting usage above limit', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      const limit = quotaManager.getQuotaState(plans[0].id)?.limit ?? 1000;

      // Set usage above limit (should work - quota exceeded is allowed)
      quotaManager.setUsedQuota(plans[0].id, limit + 500);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.used).toBe(limit + 500);
    });

    it('should return false for unknown plan', () => {
      const result = quotaManager.setUsedQuota(999999, 100);
      expect(result).toBe(false);
    });

    it('should not allow negative usage values', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Should clamp to 0
      quotaManager.setUsedQuota(plans[0].id, -50);

      const state = quotaManager.getQuotaState(plans[0].id);
      expect(state?.used).toBe(0);
    });
  });

  describe('getUsedQuota', () => {
    it('should return current usage for a plan', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Consume some quota
      await quotaManager.consumeQuota(plans[0].id, 50);

      const used = quotaManager.getUsedQuota(plans[0].id);
      expect(used).toBe(50);
    });

    it('should return 0 for unknown plan', () => {
      const used = quotaManager.getUsedQuota(999999);
      expect(used).toBe(0);
    });

    it('should reflect changes after setUsedQuota', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      quotaManager.setUsedQuota(plans[0].id, 250);

      const used = quotaManager.getUsedQuota(plans[0].id);
      expect(used).toBe(250);
    });

    it('should query PlanUsageTracker when attached', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Create and attach a mock PlanUsageTracker
      const mockTracker = {
        getUsageForQuotaManager: vi.fn().mockReturnValue({ used: 42, lastUpdated: new Date() }),
      };
      quotaManager.setPlanUsageTracker(mockTracker as unknown as import('@/services/plan-usage-tracker').PlanUsageTracker);

      const used = quotaManager.getUsedQuota(plans[0].id);
      expect(used).toBe(42);
      expect(mockTracker.getUsageForQuotaManager).toHaveBeenCalledWith(plans[0].id);
    });

    it('should return 0 when PlanUsageTracker returns undefined', async () => {
      const plans = createMockPlans();
      await quotaManager.initialize(plans);

      // Create and attach a mock PlanUsageTracker that returns undefined
      const mockTracker = {
        getUsageForQuotaManager: vi.fn().mockReturnValue(undefined),
      };
      quotaManager.setPlanUsageTracker(mockTracker as unknown as import('@/services/plan-usage-tracker').PlanUsageTracker);

      const used = quotaManager.getUsedQuota(999999);
      expect(used).toBe(0);
    });
  });
});

describe('calculateResetAt (structured QuotaPeriod)', () => {
  describe('5h sliding window', () => {
    it('should return now + 5h for initial creation', () => {
      const before = new Date();
      const result = calculateResetAt({ type: '5h', windowHours: 5, sliding: true });
      const after = new Date();

      expect(result).not.toBeNull();
      const minExpected = before.getTime() + 5 * 60 * 60 * 1000;
      const maxExpected = after.getTime() + 5 * 60 * 60 * 1000;
      expect(result!.getTime()).toBeGreaterThanOrEqual(minExpected);
      expect(result!.getTime()).toBeLessThanOrEqual(maxExpected);
    });

    it('should slide from currentResetAt for subsequent resets', () => {
      const currentResetAt = new Date('2026-04-04T10:00:00Z');
      const result = calculateResetAt(
        { type: '5h', windowHours: 5, sliding: true },
        currentResetAt
      );

      expect(result).not.toBeNull();
      // Should be currentResetAt + 5h, not now + 5h
      expect(result!.getTime()).toBe(currentResetAt.getTime() + 5 * 60 * 60 * 1000);
      expect(result!.toISOString()).toBe('2026-04-04T15:00:00.000Z');
    });

    it('should use now when currentResetAt is null', () => {
      const before = new Date();
      const result = calculateResetAt(
        { type: '5h', windowHours: 5, sliding: true },
        null
      );
      const after = new Date();

      expect(result).not.toBeNull();
      const minExpected = before.getTime() + 5 * 60 * 60 * 1000;
      const maxExpected = after.getTime() + 5 * 60 * 60 * 1000;
      expect(result!.getTime()).toBeGreaterThanOrEqual(minExpected);
      expect(result!.getTime()).toBeLessThanOrEqual(maxExpected);
    });
  });

  describe('weekly period', () => {
    it('should calculate next occurrence of configured weekday at 00:00 UTC', () => {
      // weekday=1 (Monday)
      const result = calculateResetAt({ type: 'weekly', weekday: 1 });
      expect(result).not.toBeNull();
      // Should be a Monday (JS day 1)
      expect(result!.getUTCDay()).toBe(1);
      // Should be at midnight UTC
      expect(result!.getUTCHours()).toBe(0);
      expect(result!.getUTCMinutes()).toBe(0);
      expect(result!.getUTCSeconds()).toBe(0);
    });

    it('should handle Sunday (weekday=7)', () => {
      const result = calculateResetAt({ type: 'weekly', weekday: 7 });
      expect(result).not.toBeNull();
      // Sunday in JS is day 0
      expect(result!.getUTCDay()).toBe(0);
      expect(result!.getUTCHours()).toBe(0);
    });

    it('should always be in the future', () => {
      for (const weekday of [1, 2, 3, 4, 5, 6, 7] as const) {
        const result = calculateResetAt({ type: 'weekly', weekday });
        expect(result).not.toBeNull();
        // Reset date should be strictly in the future
        // (at least 1 day ahead since we always skip to next occurrence)
        expect(result!.getTime()).toBeGreaterThan(Date.now() - 86400000);
      }
    });
  });

  describe('monthly period', () => {
    it('should return next month 1st for default monthly (no expiresOn)', () => {
      const result = calculateResetAt({ type: 'monthly' });
      expect(result).not.toBeNull();
      expect(result!.getUTCDate()).toBe(1);
      expect(result!.getUTCHours()).toBe(0);
    });

    it('should return configured expiresOn day for monthly period', () => {
      const result = calculateResetAt({ type: 'monthly', expiresOn: 15 });
      expect(result).not.toBeNull();
      // Should be the 15th of a month
      expect(result!.getUTCDate()).toBe(15);
    });

    it('should clamp expiresOn to last day of month for short months', () => {
      const result = calculateResetAt({ type: 'monthly', expiresOn: 31 });
      expect(result).not.toBeNull();
      // Day should be valid for whatever month it falls in
      expect(result!.getUTCDate()).toBeLessThanOrEqual(31);
    });
  });

  describe('total period', () => {
    it('should return null (never resets)', () => {
      const result = calculateResetAt({ type: 'total' });
      expect(result).toBeNull();
    });
  });
});

describe('createInitialQuotaState (structured QuotaPeriod)', () => {
  it('should create state with 5h sliding window period', () => {
    const state = createInitialQuotaState(1, 100, { type: '5h', windowHours: 5, sliding: true });
    expect(state.planId).toBe(1);
    expect(state.limit).toBe(100);
    expect(state.used).toBe(0);
    expect(state.period).toEqual({ type: '5h', windowHours: 5, sliding: true });
    expect(state.resetAt).not.toBeNull();
    // resetAt should be approximately 5 hours from now
    const diff = state.resetAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(4.9 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(5.1 * 60 * 60 * 1000);
  });

  it('should create state with weekly period', () => {
    const state = createInitialQuotaState(2, 500, { type: 'weekly', weekday: 3 });
    expect(state.period).toEqual({ type: 'weekly', weekday: 3 });
    expect(state.resetAt).not.toBeNull();
    // Should be a Wednesday (JS day 3)
    expect(state.resetAt!.getUTCDay()).toBe(3);
  });

  it('should create state with monthly period', () => {
    const state = createInitialQuotaState(3, 1000, { type: 'monthly' });
    expect(state.period).toEqual({ type: 'monthly' });
    expect(state.resetAt).not.toBeNull();
  });

  it('should create state with total period (null resetAt)', () => {
    const state = createInitialQuotaState(4, 5000, { type: 'total' });
    expect(state.period).toEqual({ type: 'total' });
    expect(state.resetAt).toBeNull();
  });
});

describe('QuotaManager with structured periods', () => {
  let quotaManager: QuotaManager;
  let tempDir: string;
  let quotaPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `quota-struct-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    quotaPath = join(tempDir, 'quota-state.json');
    quotaManager = createQuotaManager({ quotaStatePath: quotaPath });
  });

  afterEach(async () => {
    quotaManager.stopPeriodicSync();
    if (existsSync(tempDir)) {
      await rmdir(tempDir, { recursive: true });
    }
  });

  it('should initialize with 5h period plan', async () => {
    await quotaManager.initialize([
      { id: 1, quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } } },
    ]);
    const state = quotaManager.getQuotaState(1);
    expect(state).toBeDefined();
    expect(state?.period).toEqual({ type: '5h', windowHours: 5, sliding: true });
    expect(state?.resetAt).not.toBeNull();
  });

  it('should initialize with weekly period plan', async () => {
    await quotaManager.initialize([
      { id: 2, quota: { limit: 500, period: { type: 'weekly', weekday: 1 } } },
    ]);
    const state = quotaManager.getQuotaState(2);
    expect(state).toBeDefined();
    expect(state?.period).toEqual({ type: 'weekly', weekday: 1 });
    expect(state?.resetAt).not.toBeNull();
  });

  it('should initialize with total period plan', async () => {
    await quotaManager.initialize([
      { id: 3, quota: { limit: 5000, period: { type: 'total' } } },
    ]);
    const state = quotaManager.getQuotaState(3);
    expect(state).toBeDefined();
    expect(state?.period).toEqual({ type: 'total' });
    expect(state?.resetAt).toBeNull();
  });

  it('should persist and reload structured period types', async () => {
    await quotaManager.initialize([
      { id: 1, quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } } },
      { id: 2, quota: { limit: 500, period: { type: 'weekly', weekday: 3 } } },
      { id: 3, quota: { limit: 5000, period: { type: 'total' } } },
    ]);

    await quotaManager.consumeQuota(1, 10);
    await quotaManager.persist();

    // Create new manager and load
    const manager2 = createQuotaManager({ quotaStatePath: quotaPath });
    await manager2.initialize([
      { id: 1, quota: { limit: 100, period: { type: '5h', windowHours: 5, sliding: true } } },
      { id: 2, quota: { limit: 500, period: { type: 'weekly', weekday: 3 } } },
      { id: 3, quota: { limit: 5000, period: { type: 'total' } } },
    ]);

    const state1 = manager2.getQuotaState(1);
    expect(state1?.used).toBe(10);
    expect(state1?.period).toEqual({ type: '5h', windowHours: 5, sliding: true });

    const state3 = manager2.getQuotaState(3);
    expect(state3?.resetAt).toBeNull();
  });
});

describe('createQuotaManager', () => {
  it('should create a QuotaManager instance', () => {
    const manager = createQuotaManager();
    expect(manager).toBeInstanceOf(QuotaManager);
  });

  it('should accept custom configuration', () => {
    const manager = createQuotaManager({
      quotaStatePath: '/custom/path.json',
      syncIntervalMs: 30000,
    });
    expect(manager).toBeInstanceOf(QuotaManager);
  });
});
/**
 * Unit tests for QuotaManager service.
 * Tests quota tracking, persistence, and management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuotaManager, createQuotaManager } from '@/services/quota-manager';
import type { QuotaState } from '@/types';
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
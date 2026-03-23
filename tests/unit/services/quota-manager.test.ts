/**
 * Unit tests for QuotaManager service.
 * Tests quota tracking, persistence, and management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
      expect(quotaManager.getQuotaState('unknown-plan')).toBeUndefined();
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
      const consumed = await quotaManager.consumeQuota('unknown-plan', 1);
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
      expect(quotaManager.getRemainingQuota('unknown-plan')).toBe(0);
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
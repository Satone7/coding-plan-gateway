/**
 * Unit tests for PlanSelector service.
 * Tests plan selection logic based on model availability and quota.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanSelector, createPlanSelector, resetStrategyState } from '@/services/plan-selector';
import { logger } from '@/utils/logger';
import { createMockPlans, createMockQuotaStates } from '../../fixtures/mock-plans';
import type { CodingPlan, QuotaState } from '@/types';

/** Build a minimal active plan that serves `model`, with optional weight. */
function makeWrrPlan(id: number, model: string, weight?: number): CodingPlan {
  return {
    id,
    name: `plan-${id}`,
    provider: 'custom',
    baseUrl: 'https://example.test',
    apiKeyEncrypted: 'key',
    models: [model],
    quota: { limit: 1000, period: 'total' },
    status: 'active',
    enable: true,
    weight,
  } as unknown as CodingPlan;
}

describe('PlanSelector', () => {
  let planSelector: PlanSelector;
  let mockPlans: CodingPlan[];
  let mockQuotaStates: Map<number, QuotaState>;

  beforeEach(() => {
    planSelector = createPlanSelector();
    mockPlans = createMockPlans();
    mockQuotaStates = new Map(
      createMockQuotaStates().map((state) => [state.planId, state])
    );
  });

  describe('selectPlan', () => {
    it('should return undefined when no plans support the model', () => {
      const result = planSelector.selectPlan('unknown-model-xyz', mockPlans, mockQuotaStates);
      expect(result).toBeUndefined();
    });

    it('should return the first active plan when no quota states provided', () => {
      const result = planSelector.selectPlan('claude-sonnet-4-6', mockPlans, new Map());
      expect(result).toBeDefined();
      expect(result?.models).toContain('claude-sonnet-4-6');
      expect(result?.status).toBe('active');
    });

    it('should select plan with highest remaining quota', () => {
      // claude-sonnet-4-6 is supported by plan 2 (limit: 500, used: 200, remaining: 300)
      const result = planSelector.selectPlan('claude-sonnet-4-6', mockPlans, mockQuotaStates);
      expect(result).toBeDefined();
      expect(result?.id).toBe(2);
    });

    it('should skip paused plans', () => {
      const result = planSelector.selectPlan('paused-model', mockPlans, mockQuotaStates);
      expect(result).toBeUndefined();
    });

    it('should skip exhausted plans', () => {
      const result = planSelector.selectPlan('exhausted-model', mockPlans, mockQuotaStates);
      expect(result).toBeUndefined();
    });

    it('should handle case-insensitive model matching', () => {
      const result = planSelector.selectPlan('CLAUDE-SONNET-4-6', mockPlans, mockQuotaStates);
      expect(result).toBeDefined();
      expect(result?.models).toContain('claude-sonnet-4-6');
    });

    it('should select plan using model aliases', () => {
      const planWithAlias = {
        ...mockPlans[0],
        modelAliases: {
          'alias-kimi': 'kimi-k2.5'
        }
      };
      const result = planSelector.selectPlan('alias-kimi', [planWithAlias, ...mockPlans.slice(1)], mockQuotaStates);
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
    });

    it('should ignore alias if target canonical model is not in models', () => {
      const planWithInvalidAlias = {
        ...mockPlans[0],
        modelAliases: {
          'alias-invalid': 'not-in-models'
        }
      };
      const result = planSelector.selectPlan('alias-invalid', [planWithInvalidAlias, ...mockPlans.slice(1)], mockQuotaStates);
      expect(result).toBeUndefined();
    });
  });

  describe('findPlansByModel', () => {
    it('should return all plans supporting the model', () => {
      const result = planSelector.findPlansByModel('claude-sonnet-4-6', mockPlans);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe(2);
    });

    it('should return empty array when no plans support the model', () => {
      const result = planSelector.findPlansByModel('unknown-model', mockPlans);
      expect(result).toEqual([]);
    });

    it('should filter out inactive plans by default', () => {
      const result = planSelector.findPlansByModel('paused-model', mockPlans);
      expect(result).toEqual([]);
    });

    it('should include inactive plans when specified', () => {
      const result = planSelector.findPlansByModel('paused-model', mockPlans, {
        includeInactive: true,
      });
      expect(result.length).toBe(1);
      expect(result[0].status).toBe('paused');
    });
  });

  describe('supportsModel', () => {
    it('should return true for exact model match', () => {
      expect(planSelector.supportsModel(mockPlans[0], 'kimi-k2')).toBe(true);
    });

    it('should return true for case-insensitive match', () => {
      expect(planSelector.supportsModel(mockPlans[0], 'KIMI-K2')).toBe(true);
    });

    it('should return false for unsupported model', () => {
      expect(planSelector.supportsModel(mockPlans[0], 'gpt-4')).toBe(false);
    });

    it('should return true for valid model alias', () => {
      const planWithAlias = {
        ...mockPlans[0],
        modelAliases: { 'alias-kimi': 'kimi-k2' }
      };
      expect(planSelector.supportsModel(planWithAlias, 'alias-kimi')).toBe(true);
    });

    it('should return false for invalid model alias', () => {
      const planWithAlias = {
        ...mockPlans[0],
        modelAliases: { 'alias-invalid': 'not-in-models' }
      };
      expect(planSelector.supportsModel(planWithAlias, 'alias-invalid')).toBe(false);
    });
  });

  describe('filterActivePlans', () => {
    it('should return only active plans', () => {
      const result = planSelector.filterActivePlans(mockPlans);
      expect(result.every((p) => p.status === 'active')).toBe(true);
      expect(result.length).toBe(3); // plans 1, 2, 3
    });

    it('should return empty array when no active plans', () => {
      const allInactive = mockPlans.filter((p) => p.status !== 'active');
      const result = planSelector.filterActivePlans(allInactive);
      expect(result).toEqual([]);
    });
  });

  describe('selectBestPlan', () => {
    it('should select plan with highest multi-factor score', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.selectBestPlan(activePlans, mockQuotaStates);
      // With multi-factor scoring (expiration 40%, RPM 40%, quota 20%):
      // - No expiration = score 10 for all
      // - No RPM tracker = score 100 for all
      // - Quota scores: kimi 55, claude 60, openai 25
      // Total: kimi 55, claude 56, openai 49
      // Claude wins with highest multi-factor score
      expect(result?.id).toBe(2);
    });

    it('should return undefined when all plans are exhausted', () => {
      const exhaustedStates = new Map<number, QuotaState>();
      mockPlans.forEach((plan) => {
        exhaustedStates.set(plan.id, {
          planId: plan.id,
          used: plan.quota.limit,
          limit: plan.quota.limit,
          period: 'monthly',
          lastUpdated: new Date(),
          resetAt: null,
        });
      });

      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.selectBestPlan(activePlans, exhaustedStates);
      expect(result).toBeUndefined();
    });

    it('should return a plan when no quota states provided (uses plan limits)', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.selectBestPlan(activePlans, new Map());
      // With no quota states, all plans have 100% quota remaining
      // Quota score = 100 for all
      // Total = 10*0.4 + 100*0.4 + 100*0.2 = 84 for all
      // Any plan could be selected, but should return one
      expect(result).toBeDefined();
      expect([1, 2, 3]).toContain(result?.id);
    });

    it('should use usageResetTimes for expiration score when plan has no expiresOn', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      // Remove any existing expiration config from plans
      const plansNoExpiration = activePlans.map((p) => ({
        ...p,
        expiresOn: undefined,
        expiresAt: undefined,
      }));

      // Create usageResetTimes with a reset time 12 hours from now (milliseconds)
      // Using Usage API scoring: 12 hours = score 70 (12-24 hours range)
      const now = Date.now();
      const resetIn12Hours = now + 12 * 3600 * 1000; // Milliseconds (as Zhipu API returns)
      const usageResetTimes = new Map<number, number>();
      usageResetTimes.set(1, resetIn12Hours); // Plan 1 expires in 12 hours

      const context = {
        model: 'kimi-k2',
        plans: plansNoExpiration,
        quotaStates: mockQuotaStates,
        config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
        usageResetTimes,
      };

      const result = planSelector.selectBestPlan(context);
      // Plan 1 should have higher expiration score (70 vs 10) due to usageResetTimes
      // Usage API scoring: 12 hours → score 70
      // Plan 1: 70*0.4 + 100*0.4 + 55*0.2 = 28 + 40 + 11 = 79
      // Other plans (no reset): 10*0.4 + 100*0.4 + quota_score*0.2 = much lower
      expect(result?.id).toBe(1);
    });

    it('should use Usage API scoring (aggressive weekly) for usageResetTimes', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const plansNoExpiration = activePlans.map((p) => ({
        ...p,
        expiresOn: undefined,
        expiresAt: undefined,
      }));

      // Test that Usage API scoring uses aggressive weekly-based thresholds
      // < 3 hours → 100, 3-6 hours → 90, 6-12 hours → 80, 12-24 hours → 70, etc.

      // Plan 2 expires in 4 hours (should get score 90 with Usage API scoring)
      const now = Date.now();
      const resetIn4Hours = now + 4 * 3600 * 1000; // Milliseconds
      const usageResetTimes = new Map<number, number>();
      usageResetTimes.set(2, resetIn4Hours);

      const context = {
        model: 'claude-sonnet-4-6',
        plans: plansNoExpiration,
        quotaStates: mockQuotaStates,
        config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
        usageResetTimes,
      };

      const result = planSelector.selectBestPlan(context);
      // Plan 2 with Usage API expiration (4 hours → score 90)
      // Plan 2: 90*0.4 + 100*0.4 + 60*0.2 = 36 + 40 + 12 = 88
      expect(result?.id).toBe(2);
    });

    it('should fallback to quotaState.resetAt when no usageResetTimes and no plan expiration', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const plansNoExpiration = activePlans.map((p) => ({
        ...p,
        expiresOn: undefined,
        expiresAt: undefined,
      }));

      // Create quotaStates with resetAt 6 hours from now
      // Standard scoring (not Usage API): 6 hours → score 90 (1-24 hours range)
      const resetIn6Hours = new Date(Date.now() + 6 * 3600 * 1000);
      const quotaStatesWithReset = new Map<number, QuotaState>();
      quotaStatesWithReset.set(1, {
        planId: 1,
        used: 0,
        limit: 100,
        period: { type: '5h', windowHours: 5, sliding: true },
        lastUpdated: new Date(),
        resetAt: resetIn6Hours,
      });
      quotaStatesWithReset.set(2, {
        planId: 2,
        used: 0,
        limit: 100,
        period: { type: 'total' },
        lastUpdated: new Date(),
        resetAt: null,
      });
      quotaStatesWithReset.set(3, {
        planId: 3,
        used: 0,
        limit: 100,
        period: { type: 'total' },
        lastUpdated: new Date(),
        resetAt: null,
      });

      const context = {
        model: 'kimi-k2',
        plans: plansNoExpiration,
        quotaStates: quotaStatesWithReset,
        config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
        // No usageResetTimes provided
      };

      const result = planSelector.selectBestPlan(context);
      // Plan 1 should have higher expiration score (90) due to quotaState.resetAt
      expect(result?.id).toBe(1);
    });

    it('should use usagePercentages for quota score for Usage API plans', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const plansNoExpiration = activePlans.map((p) => ({
        ...p,
        expiresOn: undefined,
        expiresAt: undefined,
      }));

      // Create usageResetTimes and usagePercentages simulating Zhipu Usage API
      const now = Date.now();
      const resetIn24Hours = now + 24 * 3600 * 1000; // Milliseconds (as Zhipu API returns)

      const usageResetTimes = new Map<number, number>();
      usageResetTimes.set(1, resetIn24Hours); // Plan 1 expires in 1 day

      // Plan 1 has 10% used → quota score = 90
      // Plan 2 has 56% used → quota score = 44
      const usagePercentages = new Map<number, number>();
      usagePercentages.set(1, 10); // 10% used
      usagePercentages.set(2, 56); // 56% used

      const context = {
        model: 'claude-sonnet-4-6', // Supported by plan 2
        plans: plansNoExpiration,
        quotaStates: mockQuotaStates,
        config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
        usageResetTimes,
        usagePercentages,
      };

      const result = planSelector.selectBestPlan(context);
      // Plan 1 (expires in 1 day, quota 90% remaining):
      //   expiration: 60 (1-2 days), quota: 90 (100 - 10)
      //   total = 60*0.4 + 100*0.4 + 90*0.2 = 24 + 40 + 18 = 82
      // Plan 2 (no usageResetTimes so standard expiration 10, quota 44% remaining):
      //   expiration: 10, quota: 44 (100 - 56)
      //   total = 10*0.4 + 100*0.4 + 44*0.2 = 4 + 40 + 8.8 = 52.8
      // Plan 1 wins due to higher quota score and usage-api expiration scoring
      expect(result?.id).toBe(1);
    });
  });

  describe('sortByRemainingQuota', () => {
    it('should sort plans by remaining quota descending', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.sortByRemainingQuota(activePlans, mockQuotaStates);

      // Verify descending order
      let prevRemaining = Infinity;
      for (const plan of result) {
        const state = mockQuotaStates.get(plan.id);
        const remaining = state ? state.limit - state.used : plan.quota.limit;
        expect(remaining).toBeLessThanOrEqual(prevRemaining);
        prevRemaining = remaining;
      }
    });
  });

  describe('weighted-round-robin strategy', () => {
    // Regression: the previous WRR implementation always awarded ties to the
    // first plan in config order and reset a plan's counter to full weight the
    // instant it hit zero, so two equally-weighted plans degenerated to
    // "first plan wins 100%" — the second plan was never selected.
    it('distributes requests evenly across two equally-weighted plans', () => {
      resetStrategyState();
      const selector = createPlanSelector({ strategy: 'weighted-round-robin' });
      const plans: CodingPlan[] = [
        makeWrrPlan(13, 'k3'),
        makeWrrPlan(14, 'k3'),
      ];
      const counts = new Map<number, number>([[13, 0], [14, 0]]);
      for (let i = 0; i < 20; i++) {
        const picked = selector.selectBestPlan({
          model: 'k3',
          plans,
          quotaStates: new Map(),
          config: { strategy: 'weighted-round-robin' },
        });
        counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
      }
      // Both plans must receive traffic — the old bug gave plan 13 all 20.
      expect(counts.get(13)).toBeGreaterThan(0);
      expect(counts.get(14)).toBeGreaterThan(0);
      // Smooth WRR alternates: exactly half each over an even run.
      expect(counts.get(13)).toBe(10);
      expect(counts.get(14)).toBe(10);
    });

    it('distributes requests proportionally to plan weights', () => {
      resetStrategyState();
      const selector = createPlanSelector({ strategy: 'weighted-round-robin' });
      const plans: CodingPlan[] = [
        makeWrrPlan(13, 'k3', 3),
        makeWrrPlan(14, 'k3', 1),
      ];
      const counts = new Map<number, number>([[13, 0], [14, 0]]);
      for (let i = 0; i < 40; i++) {
        const picked = selector.selectBestPlan({
          model: 'k3',
          plans,
          quotaStates: new Map(),
          config: { strategy: 'weighted-round-robin' },
        });
        counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
      }
      // 3:1 ratio over 40 selections → 30 vs 10.
      expect(counts.get(13)).toBe(30);
      expect(counts.get(14)).toBe(10);
    });

    it('never selects a weight-0 plan when a positive-weight plan exists', () => {
      resetStrategyState();
      const selector = createPlanSelector({ strategy: 'weighted-round-robin' });
      const plans: CodingPlan[] = [
        makeWrrPlan(13, 'k3', 1),
        makeWrrPlan(14, 'k3', 0), // failover-only
      ];
      const counts = new Map<number, number>([[13, 0], [14, 0]]);
      for (let i = 0; i < 10; i++) {
        const picked = selector.selectBestPlan({
          model: 'k3',
          plans,
          quotaStates: new Map(),
          config: { strategy: 'weighted-round-robin' },
        });
        counts.set(picked!.id, (counts.get(picked!.id) ?? 0) + 1);
      }
      expect(counts.get(13)).toBe(10);
      expect(counts.get(14)).toBe(0);
    });
  });

  describe('weight=0 failover-only across strategies (M1)', () => {
    it('excludes a weight-0 plan from primary selection under quota-priority even if it scores higher', () => {
      resetStrategyState();
      // Default strategy is quota-priority. Give the weight-0 plan a much
      // larger remaining quota so it would win on score alone.
      const highQuota = (id: number, weight?: number): CodingPlan => ({
        ...makeWrrPlan(id, 'k3', weight),
        quota: { limit: 1_000_000, period: 'total' },
      }) as CodingPlan;
      const plans: CodingPlan[] = [
        highQuota(13, 1),
        highQuota(14, 0), // failover-only despite huge quota
      ];
      const selector = createPlanSelector(); // default quota-priority
      for (let i = 0; i < 10; i++) {
        const picked = selector.selectBestPlan({
          model: 'k3',
          plans,
          quotaStates: new Map(),
          config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
        });
        expect(picked?.id).toBe(13);
      }
    });

    it('still selects a weight-0 plan when it is the only candidate', () => {
      resetStrategyState();
      const plans: CodingPlan[] = [makeWrrPlan(14, 'k3', 0)];
      const selector = createPlanSelector();
      const picked = selector.selectBestPlan({
        model: 'k3',
        plans,
        quotaStates: new Map(),
        config: { strategy: 'quota-priority', factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 } },
      });
      expect(picked?.id).toBe(14);
    });
  });

  describe('factorWeights warning (M2)', () => {
    it('does not warn under quota-priority with custom factorWeights', () => {
      resetStrategyState();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      createPlanSelector({ strategy: 'quota-priority', factorWeights: { expiration: 0.5, rpm: 0.3, quota: 0.2 } });
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('warns when custom factorWeights are set under a non-scoring strategy', () => {
      resetStrategyState();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      createPlanSelector({ strategy: 'weighted-round-robin', factorWeights: { expiration: 0.5, rpm: 0.3, quota: 0.2 } });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('factorWeights is configured but the active strategy ignores it'),
        expect.anything(),
      );
      warnSpy.mockRestore();
    });
  });
});

describe('createPlanSelector', () => {
  it('should create a PlanSelector instance', () => {
    const selector = createPlanSelector();
    expect(selector).toBeInstanceOf(PlanSelector);
  });
});
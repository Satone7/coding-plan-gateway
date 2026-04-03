/**
 * Unit tests for PlanSelector service.
 * Tests plan selection logic based on model availability and quota.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanSelector, createPlanSelector } from '@/services/plan-selector';
import { createMockPlans, createMockQuotaStates } from '../../fixtures/mock-plans';
import type { CodingPlan, QuotaState } from '@/types';

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
});

describe('createPlanSelector', () => {
  it('should create a PlanSelector instance', () => {
    const selector = createPlanSelector();
    expect(selector).toBeInstanceOf(PlanSelector);
  });
});
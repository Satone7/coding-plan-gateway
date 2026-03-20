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
  let mockQuotaStates: Map<string, QuotaState>;

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
      // claude-sonnet-4-6 is supported by plan-2-claude (limit: 500, used: 200, remaining: 300)
      const result = planSelector.selectPlan('claude-sonnet-4-6', mockPlans, mockQuotaStates);
      expect(result).toBeDefined();
      expect(result?.id).toBe('plan-2-claude');
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
  });

  describe('findPlansByModel', () => {
    it('should return all plans supporting the model', () => {
      const result = planSelector.findPlansByModel('claude-sonnet-4-6', mockPlans);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('plan-2-claude');
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

  describe('filterActivePlans', () => {
    it('should return only active plans', () => {
      const result = planSelector.filterActivePlans(mockPlans);
      expect(result.every((p) => p.status === 'active')).toBe(true);
      expect(result.length).toBe(3); // plan-1-kimi, plan-2-claude, plan-3-openai
    });

    it('should return empty array when no active plans', () => {
      const allInactive = mockPlans.filter((p) => p.status !== 'active');
      const result = planSelector.filterActivePlans(allInactive);
      expect(result).toEqual([]);
    });
  });

  describe('selectBestPlan', () => {
    it('should select plan with highest remaining quota', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.selectBestPlan(activePlans, mockQuotaStates);
      // plan-3-openai has 500 remaining (2000-1500), plan-1-kimi has 550 remaining (1000-450)
      // plan-2-claude has 300 remaining (500-200)
      // So plan-1-kimi should be selected
      expect(result?.id).toBe('plan-1-kimi');
    });

    it('should return undefined when all plans are exhausted', () => {
      const exhaustedStates = new Map<string, QuotaState>();
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

    it('should return plan with highest limit when no quota states provided', () => {
      const activePlans = mockPlans.filter((p) => p.status === 'active');
      const result = planSelector.selectBestPlan(activePlans, new Map());
      // When no quota states, the plan with highest limit is selected
      // plan-3-openai has limit 2000, plan-1-kimi has 1000, plan-2-claude has 500
      expect(result?.id).toBe('plan-3-openai');
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
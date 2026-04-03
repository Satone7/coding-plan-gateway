/**
 * Unit tests for RequestRouter service.
 * Tests request routing, failover, and circuit breaker integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestRouter, createRequestRouter } from '@/services/request-router';
import { createMockPlans } from '../../fixtures/mock-plans';
import type { IPlanRepository } from '@/services/plan-repository';

import { planSupportsModel } from '@/utils/model-alias';

// Helper to create a mock repository with default behavior
function createMockRepository(): IPlanRepository {
  const mockPlans = createMockPlans();

  return {
    findById: vi.fn(),
    findAll: vi.fn().mockResolvedValue(mockPlans),
    findByModel: vi.fn().mockImplementation(async (model: string) => {
      return mockPlans.filter((plan) => planSupportsModel(plan, model));
    }),
    findActive: vi.fn().mockResolvedValue(mockPlans.filter(p => p.status === 'active')),
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getDecryptedApiKey: vi.fn().mockResolvedValue('test-api-key'),
  };
}

describe('RequestRouter', () => {
  let router: RequestRouter;
  let mockRepository: IPlanRepository;

  beforeEach(() => {
    mockRepository = createMockRepository();
    router = createRequestRouter(mockRepository);
  });

  describe('route', () => {
    it('should return routing result with selected plan', async () => {
      const result = await router.route('claude-sonnet-4-6');

      expect(result).toBeDefined();
      expect(result.selectedPlan).toBeDefined();
      expect(result.selectedPlan?.models).toContain('claude-sonnet-4-6');
      expect(result.canonicalName).toBe('claude-sonnet-4-6');
    });

    it('should resolve canonical name correctly when alias is used', async () => {
      const plans = await mockRepository.findAll();
      const plan = plans[0];
      plan.modelAliases = { 'my-alias': plan.models[0] };
      
      const result = await router.route('my-alias');
      expect(result.selectedPlan).toBeDefined();
      expect(result.selectedPlan?.id).toBe(plan.id);
      expect(result.canonicalName).toBe(plan.models[0]);
    });

    it('should return undefined selectedPlan for unsupported model', async () => {
      const result = await router.route('unknown-model-xyz');

      expect(result.selectedPlan).toBeUndefined();
      expect(result.alternativePlans).toEqual([]);
    });

    it('should return alternative plans for failover', async () => {
      const result = await router.route('claude-sonnet-4-6');

      expect(result.alternativePlans).toBeDefined();
      expect(Array.isArray(result.alternativePlans)).toBe(true);
    });

    it('should skip plans with open circuit breakers', async () => {
      const plans = await mockRepository.findActive();
      const claudePlan = plans.find(p => p.models.includes('claude-sonnet-4-6'));

      if (claudePlan) {
        // Open the circuit by recording 5 failures (default threshold)
        for (let i = 0; i < 5; i++) {
          router.markPlanFailed(claudePlan.id);
        }

        const result = await router.route('claude-sonnet-4-6');
        // Should select a different plan or none at all
        if (result.selectedPlan) {
          expect(result.selectedPlan.id).not.toBe(claudePlan.id);
        }
      }
    });
  });

  describe('markPlanSuccess', () => {
    it('should mark plan as successful', () => {
      expect(() => router.markPlanSuccess('plan-1-kimi')).not.toThrow();
    });
  });

  describe('markPlanFailed', () => {
    it('should track plan failures', () => {
      expect(() => router.markPlanFailed('plan-1-kimi')).not.toThrow();
    });
  });

  describe('getAvailablePlans', () => {
    it('should return all available plans for a model', async () => {
      const plans = await router.getAvailablePlans('claude-sonnet-4-6');

      expect(plans.length).toBeGreaterThan(0);
      expect(plans[0].models).toContain('claude-sonnet-4-6');
    });

    it('should return empty array for unsupported model', async () => {
      const plans = await router.getAvailablePlans('unknown-model');
      expect(plans).toEqual([]);
    });
  });

  describe('getPlanForRequest', () => {
    it('should return decrypted API key with selected plan', async () => {
      const result = await router.getPlanForRequest('claude-sonnet-4-6');

      expect(result).toBeDefined();
      expect(result.plan).toBeDefined();
      expect(result.apiKey).toBe('test-api-key');
    });

    it('should throw error when no plan available', async () => {
      await expect(router.getPlanForRequest('unknown-model')).rejects.toThrow();
    });
  });

  describe('createRequestRouter', () => {
    it('should create a RequestRouter instance', () => {
      const result = createRequestRouter(mockRepository);
      expect(result).toBeInstanceOf(RequestRouter);
    });
  });

  describe('RoutingResult', () => {
    it('should have correct structure', async () => {
      const result = await router.route('claude-sonnet-4-6');

      expect(result).toHaveProperty('selectedPlan');
      expect(result).toHaveProperty('alternativePlans');
      expect(result).toHaveProperty('requestId');
    });
  });
});
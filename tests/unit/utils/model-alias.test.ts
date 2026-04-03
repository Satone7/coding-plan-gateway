import { describe, it, expect } from 'vitest';
import { planSupportsModel, resolveCanonicalName } from '@/utils/model-alias';
import type { CodingPlan } from '@/types';

describe('model-alias utils', () => {
  const mockPlan: CodingPlan = {
    id: 1,
    name: 'Test Plan',
    baseUrl: 'https://api.example.com',
    apiKeyEncrypted: 'test-key',
    models: ['gpt-4-turbo', 'claude-3-opus'],
    modelAliases: {
      'gpt-4': 'gpt-4-turbo',
      'claude-3': 'claude-3-opus',
      'invalid-alias': 'non-existent-model',
    },
    quota: { limit: 100, period: 'monthly' },
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('planSupportsModel', () => {
    it('should return true for exact model match', () => {
      expect(planSupportsModel(mockPlan, 'gpt-4-turbo')).toBe(true);
    });

    it('should return true for case-insensitive model match', () => {
      expect(planSupportsModel(mockPlan, 'GPT-4-TURBO')).toBe(true);
    });

    it('should return true for valid alias', () => {
      expect(planSupportsModel(mockPlan, 'gpt-4')).toBe(true);
    });

    it('should return true for case-insensitive alias', () => {
      expect(planSupportsModel(mockPlan, 'GPT-4')).toBe(true);
    });

    it('should return false for invalid alias target', () => {
      expect(planSupportsModel(mockPlan, 'invalid-alias')).toBe(false);
    });

    it('should return false for unknown model', () => {
      expect(planSupportsModel(mockPlan, 'gpt-3.5')).toBe(false);
    });

    it('should handle plan without aliases', () => {
      const planWithoutAliases = { ...mockPlan, modelAliases: undefined };
      expect(planSupportsModel(planWithoutAliases, 'gpt-4-turbo')).toBe(true);
      expect(planSupportsModel(planWithoutAliases, 'gpt-4')).toBe(false);
    });
  });

  describe('resolveCanonicalName', () => {
    it('should return exact canonical name for direct match', () => {
      expect(resolveCanonicalName(mockPlan, 'gpt-4-turbo')).toBe('gpt-4-turbo');
    });

    it('should return exact canonical name for case-insensitive direct match', () => {
      expect(resolveCanonicalName(mockPlan, 'GPT-4-TURBO')).toBe('gpt-4-turbo');
    });

    it('should return exact canonical name for alias match', () => {
      expect(resolveCanonicalName(mockPlan, 'gpt-4')).toBe('gpt-4-turbo');
    });

    it('should return exact canonical name for case-insensitive alias match', () => {
      expect(resolveCanonicalName(mockPlan, 'GPT-4')).toBe('gpt-4-turbo');
    });

    it('should return original search name if no match found (direct or alias)', () => {
      expect(resolveCanonicalName(mockPlan, 'unknown-model')).toBe('unknown-model');
    });

    it('should return original search name if alias target is invalid', () => {
      expect(resolveCanonicalName(mockPlan, 'invalid-alias')).toBe('invalid-alias');
    });

    it('should handle plan without aliases', () => {
      const planWithoutAliases = { ...mockPlan, modelAliases: undefined };
      expect(resolveCanonicalName(planWithoutAliases, 'gpt-4-turbo')).toBe('gpt-4-turbo');
      expect(resolveCanonicalName(planWithoutAliases, 'gpt-4')).toBe('gpt-4');
    });
  });
});

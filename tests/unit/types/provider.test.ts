/**
 * Tests for provider and usage adapter type definitions.
 * Validates that types compile correctly and have expected shapes.
 */

import { describe, it, expect } from 'vitest';
import type { CodingPlan, CreateCodingPlanInput, ProviderPreset, UsageAdapter, UsageResult } from '@/types';

describe('ProviderPreset type', () => {
  it('should accept a valid preset with all fields', () => {
    const preset: ProviderPreset = {
      id: 'zhipu',
      name: 'Zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      models: ['glm-5.1', 'glm-5-turbo'],
      defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
      hasUsageApi: true,
    };
    expect(preset.id).toBe('zhipu');
    expect(preset.hasUsageApi).toBe(true);
    expect(preset.defaultModelAliases).toEqual({ 'glm-5': 'glm-5-turbo' });
  });

  it('should accept a preset without optional fields', () => {
    const preset: ProviderPreset = {
      id: 'volcengine',
      name: 'Volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      models: ['ark-code-latest'],
      hasUsageApi: false,
    };
    expect(preset.defaultModelAliases).toBeUndefined();
    expect(preset.hasUsageApi).toBe(false);
  });
});

describe('UsageAdapter type', () => {
  it('should accept a valid adapter implementation', async () => {
    const adapter: UsageAdapter = {
      providerId: 'test',
      cacheTTL: 300,
      queryUsage: async (_apiKey: string): Promise<UsageResult> => ({
        used: 50,
        limit: 100,
        percentage: 50,
      }),
    };
    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(50);
  });
});

describe('CodingPlan with provider field', () => {
  it('should accept CodingPlan with provider', () => {
    const plan: CodingPlan = {
      id: 1,
      name: 'Zhipu Plan',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKeyEncrypted: 'enc:xxx',
      models: ['glm-5.1'],
      quota: { limit: 1000, period: { type: '5h', windowHours: 5, sliding: true } },
      timeout: 300,
      status: 'active',
      provider: 'zhipu',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(plan.provider).toBe('zhipu');
  });

  it('should accept CreateCodingPlanInput with provider', () => {
    const input: CreateCodingPlanInput = {
      name: 'Zhipu Plan',
      baseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'test-key',
      models: ['glm-5.1'],
      quota: { limit: 1000, period: { type: '5h', windowHours: 5, sliding: true } },
      provider: 'zhipu',
    };
    expect(input.provider).toBe('zhipu');
  });
});

/**
 * Tests for ProviderRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '@/services/provider-registry';
import type { UsageAdapter, UsageResult } from '@/types';

function createMockAdapter(id: string): UsageAdapter {
  return {
    providerId: id,
    cacheTTL: 60,
    queryUsage: async (): Promise<UsageResult> => ({
      used: 10,
      limit: 100,
      percentage: 10,
    }),
  };
}

describe('ProviderRegistry', () => {
  describe('with no config overrides', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
      registry = new ProviderRegistry();
    });

    it('should return all built-in providers', () => {
      const providers = registry.getAllProviders();
      expect(providers.length).toBeGreaterThanOrEqual(3);
      const ids = providers.map((p) => p.id);
      expect(ids).toContain('zhipu');
      expect(ids).toContain('volcengine');
      expect(ids).toContain('ali');
    });

    it('should look up zhipu provider by id', () => {
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu).toBeDefined();
      expect(zhipu!.hasUsageApi).toBe(true);
    });

    it('should return undefined for unknown provider', () => {
      expect(registry.getProvider('unknown')).toBeUndefined();
    });

    it('should return false for hasUsageApi on unknown provider', () => {
      expect(registry.hasUsageApi('unknown')).toBe(false);
    });

    it('should return false for hasUsageApi on provider without adapter', () => {
      expect(registry.hasUsageApi('volcengine')).toBe(false);
    });

    it('should return null adapter for unknown provider', () => {
      expect(registry.getUsageAdapter('unknown')).toBeNull();
    });

    it('should return null adapter for provider without usage API', () => {
      expect(registry.getUsageAdapter('volcengine')).toBeNull();
    });

    it('should return null adapter when no adapter registered', () => {
      expect(registry.getUsageAdapter('zhipu')).toBeNull();
    });
  });

  describe('with usage adapter', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
      registry = new ProviderRegistry();
      registry.registerUsageAdapter(createMockAdapter('zhipu'));
    });

    it('should return adapter for zhipu after registration', () => {
      const adapter = registry.getUsageAdapter('zhipu');
      expect(adapter).not.toBeNull();
      expect(adapter!.providerId).toBe('zhipu');
    });

    it('should report hasUsageApi for zhipu after adapter registration', () => {
      expect(registry.hasUsageApi('zhipu')).toBe(true);
    });
  });

  describe('with config overrides', () => {
    it('should override baseUrl from config', () => {
      const registry = new ProviderRegistry({
        zhipu: { baseUrl: 'https://custom-zhipu.example.com' },
      });
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu!.baseUrl).toBe('https://custom-zhipu.example.com');
    });

    it('should override models from config', () => {
      const registry = new ProviderRegistry({
        zhipu: { models: ['custom-model'] },
      });
      const zhipu = registry.getProvider('zhipu');
      expect(zhipu!.models).toEqual(['custom-model']);
    });

    it('should add a new custom provider', () => {
      const registry = new ProviderRegistry({
        'my-provider': {
          name: 'My Provider',
          baseUrl: 'https://api.my-provider.com/v1',
          models: ['model-x'],
          hasUsageApi: false,
        },
      });
      const provider = registry.getProvider('my-provider');
      expect(provider).toBeDefined();
      expect(provider!.name).toBe('My Provider');
      expect(provider!.baseUrl).toBe('https://api.my-provider.com/v1');
    });
  });
});

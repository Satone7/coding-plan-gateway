/**
 * Tests for built-in provider presets.
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_PROVIDERS,
  getBuiltinProvider,
  BUILTIN_PROVIDER_IDS,
} from '@/config/builtin-providers';

describe('BUILTIN_PROVIDERS', () => {
  it('should contain exactly 6 providers', () => {
    expect(BUILTIN_PROVIDERS).toHaveLength(6);
  });

  it('should have unique IDs', () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have all required fields on each provider', () => {
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      // baseUrl is either a real URL (Anthropic-capable) or the empty-string
      // OpenAI-only sentinel — the latter requires openaiBaseUrl to be set.
      if (provider.baseUrl) {
        expect(provider.baseUrl).toMatch(/^https?:\/\//);
      } else {
        expect(provider.openaiBaseUrl).toMatch(/^https?:\/\//);
      }
      // At least one endpoint must be configured.
      expect(provider.baseUrl || provider.openaiBaseUrl).toBeTruthy();
      // Models come from a static list OR runtime discovery (dynamicModels).
      expect(provider.models.length > 0 || provider.dynamicModels === true).toBe(true);
      expect(typeof provider.hasUsageApi).toBe('boolean');
    }
  });
});

describe('getBuiltinProvider', () => {
  it('should return zhipu provider by id', () => {
    const zhipu = getBuiltinProvider('zhipu');
    expect(zhipu).toBeDefined();
    expect(zhipu!.id).toBe('zhipu');
    expect(zhipu!.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic');
    expect(zhipu!.models).toContain('glm-5.1');
    expect(zhipu!.models).toContain('glm-5-turbo');
    expect(zhipu!.models).toContain('glm-5.3');
    expect(zhipu!.models).toContain('glm-5.3-flash');
    expect(zhipu!.defaultModelAliases).toEqual({ 'glm-5': 'glm-5-turbo' });
    expect(zhipu!.hasUsageApi).toBe(true);
  });

  it('should return volcengine provider by id', () => {
    const ark = getBuiltinProvider('volcengine');
    expect(ark).toBeDefined();
    expect(ark!.id).toBe('volcengine');
    expect(ark!.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/coding');
    expect(ark!.models).toContain('ark-code-latest');
    expect(ark!.hasUsageApi).toBe(false);
  });

  it('should return ali provider by id', () => {
    const ali = getBuiltinProvider('ali');
    expect(ali).toBeDefined();
    expect(ali!.id).toBe('ali');
    expect(ali!.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/apps/anthropic');
    expect(ali!.models).toContain('qwen3.7-plus');
    expect(ali!.hasUsageApi).toBe(false);
  });

  it('should return deepseek provider by id', () => {
    const deepseek = getBuiltinProvider('deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek!.id).toBe('deepseek');
    expect(deepseek!.baseUrl).toBe('https://api.deepseek.com/anthropic');
    expect(deepseek!.models).toContain('deepseek-v4-flash');
    expect(deepseek!.hasUsageApi).toBe(true);
  });

  it('should return nvidia provider by id (OpenAI-only, dynamic models)', () => {
    const nvidia = getBuiltinProvider('nvidia');
    expect(nvidia).toBeDefined();
    expect(nvidia!.id).toBe('nvidia');
    // OpenAI-only sentinel: empty baseUrl, OpenAI surface only.
    expect(nvidia!.baseUrl).toBe('');
    expect(nvidia!.openaiBaseUrl).toBe('https://integrate.api.nvidia.com/v1');
    // Catalog is discovered at runtime, not maintained statically.
    expect(nvidia!.dynamicModels).toBe(true);
    expect(nvidia!.models).toEqual([]);
    expect(nvidia!.modelsExclude).toEqual(['embed', 'rerank']);
    expect(nvidia!.hasUsageApi).toBe(false);
  });

  it('should return kimi provider by id (dual-format, dynamic models)', () => {
    const kimi = getBuiltinProvider('kimi');
    expect(kimi).toBeDefined();
    expect(kimi!.id).toBe('kimi');
    // Coding-plan keys serve both Anthropic and OpenAI formats from /coding/v1.
    expect(kimi!.baseUrl).toBe('https://api.kimi.com/coding/v1');
    expect(kimi!.openaiBaseUrl).toBe('https://api.kimi.com/coding/v1');
    // Catalog is discovered at runtime, not maintained statically.
    expect(kimi!.dynamicModels).toBe(true);
    expect(kimi!.models).toEqual([]);
    expect(kimi!.hasUsageApi).toBe(true);
  });

  it('should return undefined for unknown provider id', () => {
    expect(getBuiltinProvider('unknown')).toBeUndefined();
  });
});

describe('BUILTIN_PROVIDER_IDS', () => {
  it('should list all provider IDs', () => {
    expect(BUILTIN_PROVIDER_IDS).toEqual(['zhipu', 'volcengine', 'ali', 'deepseek', 'kimi', 'nvidia']);
  });
});

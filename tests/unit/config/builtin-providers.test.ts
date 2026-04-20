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
  it('should contain providers from cc-switch', () => {
    expect(BUILTIN_PROVIDERS.length).toBeGreaterThanOrEqual(20);
  });

  it('should have unique IDs', () => {
    const ids = BUILTIN_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should have baseUrl and valid structure on each provider', () => {
    for (const provider of BUILTIN_PROVIDERS) {
      expect(provider.id).toBeTruthy();
      expect(provider.name).toBeTruthy();
      expect(provider.baseUrl).toMatch(/^https?:\/\//);
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
    expect(zhipu!.models).toContain('glm-5');
    expect(zhipu!.models).toContain('glm-5.1');
    expect(zhipu!.models).toContain('glm-5-turbo');
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
    expect(ali!.models).toContain('qwen3.5-plus');
    expect(ali!.hasUsageApi).toBe(false);
  });

  it('should return undefined for unknown provider id', () => {
    expect(getBuiltinProvider('unknown')).toBeUndefined();
  });
});

describe('BUILTIN_PROVIDER_IDS', () => {
  it('should contain key backwards-compatible IDs', () => {
    expect(BUILTIN_PROVIDER_IDS).toContain('zhipu');
    expect(BUILTIN_PROVIDER_IDS).toContain('volcengine');
    expect(BUILTIN_PROVIDER_IDS).toContain('ali');
  });
});

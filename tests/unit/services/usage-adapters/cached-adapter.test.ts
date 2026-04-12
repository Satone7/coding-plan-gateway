/**
 * Tests for CachedUsageAdapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CachedUsageAdapter } from '@/services/usage-adapters/cached-adapter';
import type { UsageAdapter, UsageResult } from '@/types';

function createMockAdapter(results: UsageResult[]): UsageAdapter {
  let callIndex = 0;
  return {
    providerId: 'test-provider',
    cacheTTL: 60,
    queryUsage: vi.fn(async () => {
      const result = results[callIndex] ?? results[results.length - 1]!;
      callIndex++;
      return result;
    }),
  };
}

describe('CachedUsageAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delegate to inner adapter on first call', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    const result = await cached.queryUsage('key1');

    expect(result.percentage).toBe(10);
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should return cached result within TTL', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
      { used: 50, limit: 100, percentage: 50 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    // First call — populates cache
    await cached.queryUsage('key1');
    // Second call within TTL — should use cache
    const result = await cached.queryUsage('key1');

    expect(result.percentage).toBe(10); // Cached value, not 50
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should refresh cache after TTL expires', async () => {
    const inner = createMockAdapter([
      { used: 10, limit: 100, percentage: 10 },
      { used: 80, limit: 100, percentage: 80 },
    ]);
    const cached = new CachedUsageAdapter(inner, 300);

    // First call
    await cached.queryUsage('key1');
    expect(inner.queryUsage).toHaveBeenCalledOnce();

    // Advance past TTL
    vi.advanceTimersByTime(301 * 1000);

    // Second call — cache expired, should call inner again
    const result = await cached.queryUsage('key1');
    expect(result.percentage).toBe(80);
    expect(inner.queryUsage).toHaveBeenCalledTimes(2);
  });

  it('should cache separately per provider ID', async () => {
    const inner: UsageAdapter = {
      providerId: 'shared',
      cacheTTL: 60,
      queryUsage: vi.fn(async (_apiKey: string) => ({
        used: 42,
        limit: 100,
        percentage: 42,
      })),
    };
    const cached = new CachedUsageAdapter(inner, 300);

    await cached.queryUsage('key-a');
    await cached.queryUsage('key-a');

    // Same key — only 1 call because cached by providerId
    expect(inner.queryUsage).toHaveBeenCalledOnce();
  });

  it('should expose providerId and cacheTTL from inner adapter', () => {
    const inner = createMockAdapter([
      { used: 0, limit: 100, percentage: 0 },
    ]);
    const cached = new CachedUsageAdapter(inner, 600);

    expect(cached.providerId).toBe('test-provider');
    expect(cached.cacheTTL).toBe(600);
  });

  it('should return stale cache on inner adapter failure', async () => {
    const goodResult: UsageResult = { used: 30, limit: 100, percentage: 30 };
    const inner: UsageAdapter = {
      providerId: 'fail-provider',
      cacheTTL: 60,
      queryUsage: vi.fn()
        .mockResolvedValueOnce(goodResult)
        .mockRejectedValueOnce(new Error('API down')),
    };
    const cached = new CachedUsageAdapter(inner, 300);

    // First call succeeds — populates cache
    const first = await cached.queryUsage('key1');
    expect(first.percentage).toBe(30);

    // Advance past TTL
    vi.advanceTimersByTime(301 * 1000);

    // Second call — inner fails, should return stale cached value
    const second = await cached.queryUsage('key1');
    expect(second.percentage).toBe(30);
  });
});

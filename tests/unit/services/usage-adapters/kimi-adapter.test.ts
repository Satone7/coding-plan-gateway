/**
 * Tests for KimiUsageAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KimiUsageAdapter } from '@/services/usage-adapters/kimi-adapter';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Real response shape captured from GET https://api.kimi.com/coding/v1/usages
 * (2026-07-19): numeric fields are strings, resetTime is ISO 8601, and the
 * rolling window carries a duration/timeUnit descriptor.
 */
const REAL_RESPONSE = {
  user: {
    userId: 'cmrg9qucp7fdvr1ucigg',
    region: 'REGION_CN',
    membership: { level: 'LEVEL_ADVANCED' },
  },
  usage: {
    limit: '100',
    used: '54',
    remaining: '46',
    resetTime: '2026-07-24T08:26:06.672179Z',
  },
  limits: [
    {
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: {
        limit: '100',
        used: '6',
        remaining: '94',
        resetTime: '2026-07-19T05:26:06.672179Z',
      },
    },
  ],
  parallel: { limit: '30' },
  totalQuota: { limit: '100', remaining: '99' },
};

describe('KimiUsageAdapter', () => {
  let adapter: KimiUsageAdapter;

  beforeEach(() => {
    adapter = new KimiUsageAdapter();
    mockFetch.mockReset();
  });

  it('should have providerId kimi', () => {
    expect(adapter.providerId).toBe('kimi');
  });

  it('should have cacheTTL of 300 seconds', () => {
    expect(adapter.cacheTTL).toBe(300);
  });

  it('should query the coding-plan usages endpoint with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => REAL_RESPONSE,
    });

    await adapter.queryUsage('sk-kimi-test-key');

    const [calledUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.kimi.com/coding/v1/usages');
    expect(options.headers).toMatchObject({
      Authorization: 'Bearer sk-kimi-test-key',
    });
  });

  it('should parse the real response into 5h and weekly windows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => REAL_RESPONSE,
    });

    const result = await adapter.queryUsage('test-key');

    expect(result.windows).toHaveLength(2);

    const fiveHour = result.windows![0];
    expect(fiveHour.type).toBe('TOKENS_LIMIT');
    expect(fiveHour.windowLabel).toBe('5h');
    expect(fiveHour.percentage).toBeCloseTo(6, 5);
    expect(fiveHour.nextResetTime).toBe(Date.parse('2026-07-19T05:26:06.672179Z'));

    const weekly = result.windows![1];
    expect(weekly.windowLabel).toBe('1w');
    expect(weekly.percentage).toBeCloseTo(54, 5);
    expect(weekly.nextResetTime).toBe(Date.parse('2026-07-24T08:26:06.672179Z'));

    // Overall percentage is the max across windows (weekly is higher here)
    expect(result.percentage).toBeCloseTo(54, 5);
    expect(result.used).toBe(54);
    expect(result.limit).toBe(100);
  });

  it('should use the highest percentage across windows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { limit: '100', used: '10', remaining: '90' },
        limits: [
          {
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
            detail: { limit: '100', used: '80', remaining: '20' },
          },
        ],
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBeCloseTo(80, 5);
  });

  it('should accept numeric (non-string) quota values', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { limit: 200, used: 50, remaining: 150, resetTime: 1_774_967_594 },
        limits: [],
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBeCloseTo(25, 5);
    // Epoch seconds are converted to milliseconds
    expect(result.windows![0].nextResetTime).toBe(1_774_967_594_000);
  });

  it('should fall back to limit - remaining when used is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        usage: { limit: '100', remaining: '30' },
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBeCloseTo(70, 5);
  });

  it('should return 0 percentage when no quota data is present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { userId: 'x' } }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(0);
    expect(result.windows).toEqual([]);
  });

  it('should skip rolling-window entries without a detail block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' } }],
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.windows).toEqual([]);
  });

  it('should throw descriptive error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(adapter.queryUsage('bad-key')).rejects.toThrow(
      'Kimi usage API returned HTTP 401: Unauthorized'
    );
  });

  it('should throw descriptive error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(adapter.queryUsage('test-key')).rejects.toThrow(
      'Failed to query Kimi usage API'
    );
  });
});

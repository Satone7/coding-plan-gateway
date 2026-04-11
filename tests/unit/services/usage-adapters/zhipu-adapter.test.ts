/**
 * Tests for ZhipuUsageAdapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZhipuUsageAdapter } from '@/services/usage-adapters/zhipu-adapter';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ZhipuUsageAdapter', () => {
  let adapter: ZhipuUsageAdapter;

  beforeEach(() => {
    adapter = new ZhipuUsageAdapter();
    mockFetch.mockReset();
  });

  it('should have providerId zhipu', () => {
    expect(adapter.providerId).toBe('zhipu');
  });

  it('should have cacheTTL of 300 seconds', () => {
    expect(adapter.cacheTTL).toBe(300);
  });

  it('should return usage result with highest percentage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          limits: [
            { type: 'TOKENS_LIMIT', percentage: 45.2 },
            { type: 'TOKENS_LIMIT', percentage: 30.1 },
          ],
        },
      }),
    });

    const result = await adapter.queryUsage('test-api-key');

    expect(result.percentage).toBe(45.2);
    expect(result.used).toBe(0);
    expect(result.limit).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the URL contains the quota/limit endpoint
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/monitor/usage/quota/limit');
  });

  it('should send Authorization header with API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 10 }] },
      }),
    });

    await adapter.queryUsage('my-secret-key');

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({
      Authorization: 'my-secret-key',
    });
  });

  it('should return 0 percentage when no TOKENS_LIMIT entries', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [{ type: 'OTHER_LIMIT', percentage: 50 }] },
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(0);
  });

  it('should return 0 percentage when limits array is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { limits: [] },
      }),
    });

    const result = await adapter.queryUsage('test-key');
    expect(result.percentage).toBe(0);
  });

  it('should throw descriptive error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(adapter.queryUsage('bad-key')).rejects.toThrow(
      'Zhipu usage API returned HTTP 401: Unauthorized'
    );
  });

  it('should throw descriptive error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(adapter.queryUsage('test-key')).rejects.toThrow(
      'Failed to query Zhipu usage API'
    );
  });
});

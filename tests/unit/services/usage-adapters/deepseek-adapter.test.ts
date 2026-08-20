/**
 * Tests for DeepseekUsageAdapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepseekUsageAdapter } from '@/services/usage-adapters/deepseek-adapter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('DeepseekUsageAdapter', () => {
  let adapter: DeepseekUsageAdapter;

  beforeEach(() => {
    adapter = new DeepseekUsageAdapter();
    mockFetch.mockReset();
  });

  it('should have providerId deepseek', () => {
    expect(adapter.providerId).toBe('deepseek');
  });

  it('should have cacheTTL of 300 seconds', () => {
    expect(adapter.cacheTTL).toBe(300);
  });

  it('should parse the first balance entry into a balance summary', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance_infos: [
          {
            currency: 'CNY',
            total_balance: '12.34',
          },
        ],
      }),
    });

    const result = await adapter.queryUsage('test-api-key');

    expect(result.summary).toEqual({
      mode: 'balance',
      value: '¥12.34',
      numericValue: 12.34,
      currency: 'CNY',
    });
    expect(result.windows).toEqual([]);
    expect(result.percentage).toBe(0);
  });

  it('should omit numericValue when the balance string is unparsable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance_infos: [{ currency: 'CNY', total_balance: 'n/a' }],
      }),
    });

    const result = await adapter.queryUsage('test-api-key');
    expect(result.summary?.numericValue).toBeUndefined();
    expect(result.summary?.value).toBe('¥n/a');
  });

  it('should target the official balance endpoint with bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance_infos: [
          {
            currency: 'USD',
            total_balance: '5.60',
          },
        ],
      }),
    });

    await adapter.queryUsage('my-secret-key');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/user/balance');
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer my-secret-key',
      },
    });
  });

  it('should fall back to raw currency code when symbol is unknown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balance_infos: [
          {
            currency: 'EUR',
            total_balance: '8.00',
          },
        ],
      }),
    });

    const result = await adapter.queryUsage('test-api-key');
    expect(result.summary?.value).toBe('EUR8.00');
  });

  it('should throw descriptive error on HTTP failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(adapter.queryUsage('bad-key')).rejects.toThrow(
      'Deepseek balance API returned HTTP 401: Unauthorized'
    );
  });
});

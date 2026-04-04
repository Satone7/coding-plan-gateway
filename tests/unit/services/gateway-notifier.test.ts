/**
 * Unit tests for GatewayNotifier service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGatewayNotifier, GatewayNotifier } from '@/services/gateway-notifier';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GatewayNotifier', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GATEWAY_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default gateway URL', () => {
      const notifier = createGatewayNotifier();
      expect(notifier.getGatewayUrl()).toBe('http://localhost:8080');
    });

    it('should use configured gateway URL', () => {
      const notifier = createGatewayNotifier({ gatewayUrl: 'http://custom:9000' });
      expect(notifier.getGatewayUrl()).toBe('http://custom:9000');
    });

    it('should use GATEWAY_URL environment variable', () => {
      process.env.GATEWAY_URL = 'http://env:7000';
      const notifier = createGatewayNotifier();
      expect(notifier.getGatewayUrl()).toBe('http://env:7000');
    });

    it('should prioritize config over environment', () => {
      process.env.GATEWAY_URL = 'http://env:7000';
      const notifier = createGatewayNotifier({ gatewayUrl: 'http://config:8000' });
      expect(notifier.getGatewayUrl()).toBe('http://config:8000');
    });
  });

  describe('notifyReload', () => {
    it('should send POST request to reload endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Reloaded: api-keys' }),
      });

      const notifier = createGatewayNotifier({ gatewayUrl: 'http://test:8080' });
      const result = await notifier.notifyReload('api-keys');

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:8080/api/internal/reload',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'api-keys' }),
        })
      );
    });

    it('should return false on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyReload('api-keys');

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyReload('api-keys');

      expect(result).toBe(false);
    });

    it('should return false when success is not true in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, message: 'Failed' }),
      });

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyReload('all');

      expect(result).toBe(false);
    });

    it('should handle timeout', async () => {
      // Mock AbortSignal.timeout
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const notifier = createGatewayNotifier({ timeout: 100 });
      const result = await notifier.notifyReload('api-keys');

      expect(result).toBe(false);
    });
  });

  describe('convenience methods', () => {
    it('notifyApiKeysChanged should call notifyReload with api-keys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyApiKeysChanged();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ type: 'api-keys' }),
        })
      );
    });

    it('notifyUsageChanged should call notifyReload with usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyUsageChanged();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ type: 'usage' }),
        })
      );
    });

    it('notifyAllChanged should call notifyReload with all', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const notifier = createGatewayNotifier();
      const result = await notifier.notifyAllChanged();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ type: 'all' }),
        })
      );
    });
  });
});
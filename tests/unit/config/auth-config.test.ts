/**
 * Unit tests for authentication configuration loader.
 * @see src/config/auth-config.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadAuthConfig,
  parseExemptPaths,
  isExemptPath,
  createDefaultAuthConfig,
} from '@/config/auth-config';
import { DEFAULT_AUTH_CONFIG } from '@/config/defaults';

describe('auth-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadAuthConfig', () => {
    it('should return default values when no env vars set', () => {
      // Clear relevant env vars
      delete process.env.API_KEYS_PATH;
      delete process.env.USAGE_DATA_PATH;
      delete process.env.AUTH_EXEMPT_PATHS;
      delete process.env.USAGE_SYNC_INTERVAL_MS;

      const config = loadAuthConfig();

      expect(config.apiKeysPath).toBe(DEFAULT_AUTH_CONFIG.apiKeysPath);
      expect(config.usageDataPath).toBe(DEFAULT_AUTH_CONFIG.usageDataPath);
      expect(config.authExemptPaths).toBe(DEFAULT_AUTH_CONFIG.authExemptPaths);
      expect(config.usageSyncIntervalMs).toBe(DEFAULT_AUTH_CONFIG.usageSyncIntervalMs);
    });

    it('should read custom paths from environment', () => {
      process.env.API_KEYS_PATH = '/custom/keys.json';
      process.env.USAGE_DATA_PATH = '/custom/usage.json';

      const config = loadAuthConfig();

      expect(config.apiKeysPath).toBe('/custom/keys.json');
      expect(config.usageDataPath).toBe('/custom/usage.json');
    });

    it('should read AUTH_EXEMPT_PATHS from the environment when set', () => {
      process.env.AUTH_EXEMPT_PATHS = '/health,/ready,/metrics';

      const config = loadAuthConfig();

      expect(config.authExemptPaths).toBe('/health,/ready,/metrics');
    });

    it('should fall back to the secure default when AUTH_EXEMPT_PATHS is empty', () => {
      process.env.AUTH_EXEMPT_PATHS = '   ';

      const config = loadAuthConfig();

      expect(config.authExemptPaths).toBe(DEFAULT_AUTH_CONFIG.authExemptPaths);
    });

    it('the default exempt list must not expose internal key CRUD unauthenticated', () => {
      const paths = parseExemptPaths(DEFAULT_AUTH_CONFIG.authExemptPaths);
      // The broad wildcard that previously exempted POST /api/internal/keys,
      // DELETE /api/internal/keys/:id and the usage report must be gone.
      expect(paths).not.toContain('/api/internal/*');
      // The self-reload notification (loopback GatewayNotifier call) stays exempt.
      expect(paths).toContain('/api/internal/reload');
    });

    it('the default exempt list must cover the read-only dashboard surface', () => {
      const paths = parseExemptPaths(DEFAULT_AUTH_CONFIG.authExemptPaths);
      expect(isExemptPath('/dashboard', paths)).toBe(true);
      expect(isExemptPath('/api/dashboard/flows', paths)).toBe(true);
      expect(isExemptPath('/api/dashboard/summary', paths)).toBe(true);
      expect(isExemptPath('/api/dashboard/errors', paths)).toBe(true);
      expect(isExemptPath('/api/dashboard/stats', paths)).toBe(true);
      // but not unrelated /api paths
      expect(isExemptPath('/api/admin/plans', paths)).toBe(false);
    });

    it('should parse sync interval from environment', () => {
      process.env.USAGE_SYNC_INTERVAL_MS = '30000';

      const config = loadAuthConfig();

      expect(config.usageSyncIntervalMs).toBe(30000);
    });

    it('should use default for invalid sync interval', () => {
      process.env.USAGE_SYNC_INTERVAL_MS = 'invalid';

      const config = loadAuthConfig();

      expect(config.usageSyncIntervalMs).toBe(DEFAULT_AUTH_CONFIG.usageSyncIntervalMs);
    });

    it('should use default for negative sync interval', () => {
      process.env.USAGE_SYNC_INTERVAL_MS = '-1000';

      const config = loadAuthConfig();

      expect(config.usageSyncIntervalMs).toBe(DEFAULT_AUTH_CONFIG.usageSyncIntervalMs);
    });
  });

  describe('parseExemptPaths', () => {
    it('should parse comma-separated paths', () => {
      const paths = parseExemptPaths('/health,/ready,/metrics');
      expect(paths).toEqual(['/health', '/ready', '/metrics']);
    });

    it('should trim whitespace from paths', () => {
      const paths = parseExemptPaths('/health , /ready , /metrics');
      expect(paths).toEqual(['/health', '/ready', '/metrics']);
    });

    it('should handle single path', () => {
      const paths = parseExemptPaths('/health');
      expect(paths).toEqual(['/health']);
    });

    it('should handle empty string', () => {
      const paths = parseExemptPaths('');
      expect(paths).toEqual([]);
    });

    it('should filter out empty entries', () => {
      const paths = parseExemptPaths('/health,,/ready,');
      expect(paths).toEqual(['/health', '/ready']);
    });
  });

  describe('isExemptPath', () => {
    it('should return true for exact match', () => {
      expect(isExemptPath('/health', ['/health', '/ready'])).toBe(true);
    });

    it('should return false for non-exempt path', () => {
      expect(isExemptPath('/api/keys', ['/health', '/ready'])).toBe(false);
    });

    it('should return true for prefix match with wildcard', () => {
      expect(isExemptPath('/api/public/endpoint', ['/api/public/*'])).toBe(true);
    });

    it('should return false for non-matching prefix', () => {
      expect(isExemptPath('/api/private/endpoint', ['/api/public/*'])).toBe(false);
    });

    it('should handle empty exempt paths', () => {
      expect(isExemptPath('/health', [])).toBe(false);
    });

    it('should match path with multiple wildcards in pattern', () => {
      // This is the pattern used for quota sync endpoint exemption
      expect(isExemptPath('/api/quota/1/sync', ['*/quota/*/sync'])).toBe(true);
      expect(isExemptPath('/api/quota/123/sync', ['*/quota/*/sync'])).toBe(true);
      expect(isExemptPath('/quota/1/sync', ['*/quota/*/sync'])).toBe(true);
    });

    it('should not match path when middle segment differs', () => {
      expect(isExemptPath('/api/plans/1/sync', ['*/quota/*/sync'])).toBe(false);
    });

    it('should match suffix-only wildcard pattern', () => {
      expect(isExemptPath('/api/quota/1/sync', ['*/sync'])).toBe(true);
      expect(isExemptPath('/any/path/sync', ['*/sync'])).toBe(true);
    });
  });

  describe('createDefaultAuthConfig', () => {
    it('should return default configuration', () => {
      const config = createDefaultAuthConfig();
      expect(config).toEqual(DEFAULT_AUTH_CONFIG);
    });

    it('should return a copy, not reference', () => {
      const config1 = createDefaultAuthConfig();
      const config2 = createDefaultAuthConfig();
      expect(config1).not.toBe(config2);
    });
  });
});
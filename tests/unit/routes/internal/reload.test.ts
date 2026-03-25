/**
 * Unit tests for internal reload endpoint.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import Fastify from 'fastify';
import { registerReloadRoutes } from '@/routes/internal/reload';
import type { ApiKeyManager } from '@/services/api-key-manager';
import type { UsageTracker } from '@/services/usage-tracker';

// Create mock managers
function createMockApiKeyManager(): ApiKeyManager {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllKeys: vi.fn().mockReturnValue([]),
    getKeyById: vi.fn().mockReturnValue(undefined),
    getKeyByPrefix: vi.fn().mockReturnValue(undefined),
    createKey: vi.fn(),
    validateKey: vi.fn(),
    validateKeyWithStatus: vi.fn(),
    updateKeyStatus: vi.fn(),
    deleteKey: vi.fn(),
    persistKeys: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getStoragePath: vi.fn().mockReturnValue('./api-keys.json'),
  } as unknown as ApiKeyManager;
}

function createMockUsageTracker(): UsageTracker {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getUsageReport: vi.fn().mockReturnValue([]),
    recordUsage: vi.fn(),
    persistUsageData: vi.fn(),
  } as unknown as UsageTracker;
}

describe('Reload Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockApiKeyManager: ApiKeyManager;
  let mockUsageTracker: UsageTracker;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    mockApiKeyManager = createMockApiKeyManager();
    mockUsageTracker = createMockUsageTracker();
  });

  async function setupApp(): Promise<void> {
    await registerReloadRoutes(app, {
      apiKeyManager: mockApiKeyManager,
      usageTracker: mockUsageTracker,
    });
    await app.ready();
  }

  describe('POST /internal/reload', () => {
    it('should reload api-keys when type is api-keys', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'api-keys' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('api-keys');
      expect((mockApiKeyManager.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
      expect((mockUsageTracker.initialize as Mock).mock.calls.length).toBe(0);
    });

    it('should reload usage when type is usage', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'usage' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('usage');
      expect((mockUsageTracker.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
      expect((mockApiKeyManager.initialize as Mock).mock.calls.length).toBe(0);
    });

    it('should reload all when type is all', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'all' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('api-keys');
      expect(body.message).toContain('usage');
      expect((mockApiKeyManager.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
      expect((mockUsageTracker.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('should default to all when no type specified', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect((mockApiKeyManager.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
      expect((mockUsageTracker.initialize as Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it('should return 400 for invalid type', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'invalid' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should return 500 when reload fails', async () => {
      (mockApiKeyManager.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Storage error')
      );
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'api-keys' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.message).toContain('Storage error');
    });

    it('should skip usage tracker when not provided', async () => {
      // Create app without usage tracker
      app = Fastify();
      await registerReloadRoutes(app, {
        apiKeyManager: mockApiKeyManager,
      });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'all' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('api-keys');
      expect(body.message).not.toContain('usage');
    });

    it('should include timestamp in response', async () => {
      await setupApp();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'api-keys' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });
  });
});
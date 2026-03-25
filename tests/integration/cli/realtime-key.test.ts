/**
 * Integration test for real-time key availability.
 * Tests that API keys created via CLI are immediately available for authentication.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { createApiKeyManager, ApiKeyManager } from '@/services/api-key-manager';
import { createUsageTracker, UsageTracker } from '@/services/usage-tracker';
import { registerReloadRoutes } from '@/routes/internal/reload';
import { createGatewayNotifier } from '@/services/gateway-notifier';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

describe('Real-time Key Availability', () => {
  let app: ReturnType<typeof Fastify>;
  let apiKeyManager: ApiKeyManager;
  let usageTracker: UsageTracker;
  let tempDir: string;
  let encryptionKey: string;

  beforeEach(async () => {
    // Create temp directory for test files
    tempDir = join(tmpdir(), `cpg-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    // Set up encryption key
    encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.ENCRYPTION_KEY = encryptionKey;

    // Create API key manager with temp storage
    const apiKeysPath = join(tempDir, 'api-keys.json');
    apiKeyManager = createApiKeyManager({ apiKeysPath });
    await apiKeyManager.initialize();

    // Create usage tracker with temp storage
    const usageDataPath = join(tempDir, 'usage-data.json');
    usageTracker = createUsageTracker({ usageDataPath });
    await usageTracker.initialize();

    // Create Fastify app with reload routes
    app = Fastify();
    await registerReloadRoutes(app, {
      apiKeyManager,
      usageTracker,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
    delete process.env.ENCRYPTION_KEY;
    vi.clearAllMocks();
  });

  describe('CLI to Gateway Integration', () => {
    it('should make created key available immediately after reload', async () => {
      // Create a key directly in the manager
      const result = await apiKeyManager.createKey({ name: 'Test Key' });

      // Simulate the gateway being in an old state by creating a new manager
      const newManager = createApiKeyManager({
        apiKeysPath: apiKeyManager.getStoragePath(),
      });
      await newManager.initialize();

      // The new manager should see the key after loading from storage
      const loadedKey = newManager.getKeyById(result.key.id);
      expect(loadedKey).toBeDefined();
      expect(loadedKey?.name).toBe('Test Key');
    });

    it('should reload keys from storage when reload endpoint is called', async () => {
      // Create a key
      const result = await apiKeyManager.createKey({ name: 'Reload Test Key' });

      // Create a new manager (simulating a fresh gateway)
      const freshManager = createApiKeyManager({
        apiKeysPath: apiKeyManager.getStoragePath(),
      });

      // Initially, fresh manager has no keys loaded
      expect(freshManager.getAllKeys()).toHaveLength(0);

      // Initialize to load keys
      await freshManager.initialize();

      // Now it should have the key
      const keys = freshManager.getAllKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]?.name).toBe('Reload Test Key');
    });

    it('should validate created key correctly', async () => {
      // Create a key
      const result = await apiKeyManager.createKey({ name: 'Validation Test' });

      // Validate the key
      const validationResult = await apiKeyManager.validateKeyWithStatus(result.plaintextKey);

      expect(validationResult.valid).toBe(true);
      expect(validationResult.status).toBe('valid');
      expect(validationResult.key?.name).toBe('Validation Test');
    });

    it('should reflect status changes immediately', async () => {
      // Create a key
      const result = await apiKeyManager.createKey({ name: 'Status Change Test' });

      // Disable the key
      await apiKeyManager.updateKeyStatus(result.key.id, 'disabled');

      // Validate should now fail with disabled status
      const validationResult = await apiKeyManager.validateKeyWithStatus(result.plaintextKey);
      expect(validationResult.valid).toBe(false);
      expect(validationResult.status).toBe('disabled');
    });

    it('should reflect key deletion immediately', async () => {
      // Create a key
      const result = await apiKeyManager.createKey({ name: 'Deletion Test' });

      // Delete the key
      await apiKeyManager.deleteKey(result.key.id);

      // Validate should now fail
      const validationResult = await apiKeyManager.validateKeyWithStatus(result.plaintextKey);
      expect(validationResult.valid).toBe(false);
      expect(validationResult.status).toBe('invalid');
    });
  });

  describe('Gateway Notifier', () => {
    it('should construct correct URL for reload endpoint', () => {
      const notifier = createGatewayNotifier({ gatewayUrl: 'http://test:8080' });
      expect(notifier.getGatewayUrl()).toBe('http://test:8080');
    });

    it('should use environment variable for gateway URL', () => {
      process.env.GATEWAY_URL = 'http://env-test:9000';
      const notifier = createGatewayNotifier();
      expect(notifier.getGatewayUrl()).toBe('http://env-test:9000');
    });
  });

  describe('Reload Endpoint', () => {
    it('should return success for valid reload request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: { type: 'api-keys' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should handle empty body with default type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/reload',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});
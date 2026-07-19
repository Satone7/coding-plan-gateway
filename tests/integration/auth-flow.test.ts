/**
 * Integration tests for API key authentication flow.
 * Tests the complete authentication flow with valid/invalid/disabled keys.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerAuthMiddleware } from '@/middleware/auth';
import { ApiKeyManager, createApiKeyManager } from '@/services/api-key-manager';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Authentication Flow Integration Tests', () => {
  let app: FastifyInstance;
  let apiKeyManager: ApiKeyManager;
  let tempDir: string;
  let keysPath: string;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `auth-integration-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    keysPath = join(tempDir, 'api-keys.json');

    // Create Fastify app
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  });

  describe('Valid key authentication', () => {
    let validKey: string;
    let keyId: string;

    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Create a test key
      const result = await apiKeyManager.createKey({ name: 'Valid Test Key' });
      validKey = result.plaintextKey;
      keyId = result.key.id;

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add test routes
      app.get('/v1/chat/completions', (request, _reply) => ({
        message: 'Chat endpoint',
        auth: request.auth,
      }));

      app.get('/v1/models', (request, _reply) => ({
        models: [],
        auth: request.auth,
      }));
    });

    it('should authenticate valid key on /v1/chat/completions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chat/completions',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.auth).toBeDefined();
      expect(body.auth.apiKey.name).toBe('Valid Test Key');
    });

    it('should authenticate valid key on /v1/models', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.auth).toBeDefined();
    });

    it('should update lastUsedAt after successful authentication', async () => {
      // Get the key before authentication
      const keyBefore = apiKeyManager.getKeyById(keyId);
      expect(keyBefore?.lastUsedAt).toBeUndefined();

      // Make authenticated request
      await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      // Check lastUsedAt was updated
      const keyAfter = apiKeyManager.getKeyById(keyId);
      expect(keyAfter?.lastUsedAt).toBeDefined();
    });
  });

  describe('Invalid key rejection (401)', () => {
    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Create a test key (but we won't use it)
      await apiKeyManager.createKey({ name: 'Test Key' });

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add test route
      app.get('/v1/chat/completions', () => ({ message: 'success' }));
    });

    it('should reject invalid key with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chat/completions',
        headers: { Authorization: 'Bearer cpg_invalidkey12345678901234567890' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return OpenAI-style error for invalid key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chat/completions',
        headers: { Authorization: 'Bearer cpg_invalidkey12345678901234567890' },
      });

      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('authentication_error');
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Missing auth header (401)', () => {
    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add test route
      app.post('/v1/messages', () => ({ message: 'success' }));
    });

    it('should reject request without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return OpenAI-style error for missing auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Missing');
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Disabled key rejection (403)', () => {
    let disabledKey: string;

    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Create a test key
      const result = await apiKeyManager.createKey({ name: 'Disabled Key' });
      disabledKey = result.plaintextKey;

      // Disable the key
      await apiKeyManager.updateKeyStatus(result.key.id, 'disabled');

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add test route
      app.get('/v1/chat/completions', () => ({ message: 'success' }));
    });

    it('should reject disabled key with 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chat/completions',
        headers: { Authorization: `Bearer ${disabledKey}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return Forbidden error for disabled key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/chat/completions',
        headers: { Authorization: `Bearer ${disabledKey}` },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('disabled');
    });
  });

  describe('Exempt paths', () => {
    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add health routes
      app.get('/health', () => ({ status: 'healthy' }));
      app.get('/ready', () => ({ ready: true }));
    });

    it('should allow /health without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('healthy');
    });

    it('should allow /ready without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ready).toBe(true);
    });
  });

  describe('Multiple keys', () => {
    let key1: string;
    let key2: string;

    beforeEach(async () => {
      // Initialize ApiKeyManager
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();

      // Create two keys
      const result1 = await apiKeyManager.createKey({ name: 'Key 1' });
      const result2 = await apiKeyManager.createKey({ name: 'Key 2' });
      key1 = result1.plaintextKey;
      key2 = result2.plaintextKey;

      // Register auth middleware
      registerAuthMiddleware(app, { apiKeyManager });

      // Add test route
      app.get('/v1/models', (request) => ({ keyName: request.auth?.apiKey?.name }));
    });

    it('should authenticate key 1', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: `Bearer ${key1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.keyName).toBe('Key 1');
    });

    it('should authenticate key 2', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: `Bearer ${key2}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.keyName).toBe('Key 2');
    });

    it('should not accept key1 for key2 prefix', async () => {
      // Create a key with different value but try to use key1's token
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: { Authorization: `Bearer ${key1}` },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Persistence across restart', () => {
    it('should persist keys across restarts', async () => {
      // First instance: create a key
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();
      const result = await apiKeyManager.createKey({ name: 'Persistent Key' });
      const keyId = result.key.id;
      const plaintextKey = result.plaintextKey;

      // Second instance: should load the key
      const newManager = createApiKeyManager({ apiKeysPath: keysPath });
      await newManager.initialize();

      const key = newManager.getKeyById(keyId);
      expect(key).toBeDefined();
      expect(key?.name).toBe('Persistent Key');

      // Should be able to validate the key
      const validated = await newManager.validateKey(plaintextKey);
      expect(validated).toBeDefined();
      expect(validated?.name).toBe('Persistent Key');
    });
  });

  describe('Internal route authentication (C3 regression)', () => {
    beforeEach(async () => {
      apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
      await apiKeyManager.initialize();
      // Uses the REAL default exempt list (no config override).
      registerAuthMiddleware(app, { apiKeyManager });

      // Sensitive internal endpoints (key CRUD) ...
      app.post('/api/internal/keys', async () => ({ created: true }));
      app.get('/api/internal/keys/:keyId', async () => ({ key: 'ok' }));
      // ... and the loopback self-reload notification.
      app.post('/api/internal/reload', async () => ({ reloaded: true }));
    });

    it('rejects unauthenticated POST /api/internal/keys (no longer exempt)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/keys',
        payload: { name: 'sneaky' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects unauthenticated GET /api/internal/keys/:id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/internal/keys/abc-123',
      });
      expect(response.statusCode).toBe(401);
    });

    it('still allows the loopback self-reload without auth', async () => {
      // GatewayNotifier calls this over localhost after a config/key change.
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/reload',
        payload: { type: 'config' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ reloaded: true });
    });
  });
});
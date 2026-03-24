/**
 * Unit tests for authentication middleware.
 * Tests Bearer token extraction, key validation, and exemption handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerAuthMiddleware, isAuthenticated, getAuthContext } from '@/middleware/auth';
import { ApiKeyManager, createApiKeyManager } from '@/services/api-key-manager';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Auth Middleware', () => {
  let app: FastifyInstance;
  let apiKeyManager: ApiKeyManager;
  let tempDir: string;
  let keysPath: string;
  let validKey: string;

  beforeEach(async () => {
    // Create temp directory and initialize ApiKeyManager
    tempDir = join(tmpdir(), `auth-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    keysPath = join(tempDir, 'api-keys.json');
    apiKeyManager = createApiKeyManager({ apiKeysPath: keysPath });
    await apiKeyManager.initialize();

    // Create a test key
    const result = await apiKeyManager.createKey({ name: 'Test Key' });
    validKey = result.plaintextKey;

    // Create Fastify app with auth middleware
    app = Fastify();
    registerAuthMiddleware(app, { apiKeyManager });

    // Add test routes
    app.get('/protected', (request, _reply) => {
      return { authenticated: isAuthenticated(request), auth: getAuthContext(request) };
    });

    app.get('/health', () => ({ status: 'healthy' }));
    app.get('/ready', () => ({ ready: true }));
  });

  afterEach(async () => {
    await app.close();
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  });

  describe('Bearer token extraction', () => {
    it('should accept valid Bearer token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.authenticated).toBe(true);
    });

    it('should reject missing Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Missing');
    });

    it('should reject malformed Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'InvalidFormat' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject Basic auth scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject empty Bearer token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'Bearer ' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Key validation', () => {
    it('should accept valid API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.authenticated).toBe(true);
      expect(body.auth?.apiKey?.name).toBe('Test Key');
    });

    it('should reject invalid API key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'Bearer cpg_invalidkey123456789012345678' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Invalid API key');
    });

    it('should reject key with wrong prefix', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: 'Bearer wrong_prefix_12345678901234567890' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Disabled key handling', () => {
    it('should reject disabled API key with 403', async () => {
      // Get key ID
      const key = apiKeyManager.getKeyByPrefix(validKey.slice(4, 12));
      expect(key).toBeDefined();

      // Disable the key
      await apiKeyManager.updateKeyStatus(key!.id, 'disabled');

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('disabled');
    });
  });

  describe('Exemption handling', () => {
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

  describe('Error response format', () => {
    it('should return proper error format for 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);

      expect(body.error).toBeDefined();
      expect(body.error.message).toBeDefined();
      expect(body.error.type).toBe('authentication_error');
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.meta.requestId).toBeDefined();
      expect(body.meta.timestamp).toBeDefined();
    });

    it('should return proper error format for 403', async () => {
      const key = apiKeyManager.getKeyByPrefix(validKey.slice(4, 12));
      await apiKeyManager.updateKeyStatus(key!.id, 'disabled');

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);

      expect(body.error).toBeDefined();
      expect(body.error.type).toBe('permission_error');
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Auth context', () => {
    it('should attach auth context to request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.auth).toBeDefined();
      expect(body.auth.apiKey).toBeDefined();
      expect(body.auth.apiKey.id).toBeDefined();
      expect(body.auth.apiKey.name).toBe('Test Key');
      expect(body.auth.apiKey.prefix).toBeDefined();
    });

    it('should not expose sensitive key data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { Authorization: `Bearer ${validKey}` },
      });

      const body = JSON.parse(response.body);
      expect(body.auth?.apiKey?.keyHash).toBeUndefined();
    });
  });
});

describe('isAuthenticated helper', () => {
  it('should return false when no auth context', () => {
    const request = {};
    expect(isAuthenticated(request as any)).toBe(false);
  });
});

describe('getAuthContext helper', () => {
  it('should return undefined when no auth context', () => {
    const request = {};
    expect(getAuthContext(request as any)).toBeUndefined();
  });
});
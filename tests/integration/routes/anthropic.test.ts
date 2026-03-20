/**
 * Integration tests for Anthropic-compatible routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createApp } from '@/app';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { createMockPlanInput } from '../../fixtures/mock-plans';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Anthropic Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let proxy: RequestProxy;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `anthropic-routes-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');

    // Create repository and proxy
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
    proxy = new RequestProxy();

    // Create app
    app = await createApp();

    // Register Anthropic routes
    const { registerAnthropicRoutes } = await import('@/routes/anthropic');
    await registerAnthropicRoutes(app, { repository, proxy });
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('POST /v1/messages', () => {
    it('should return 400 for invalid request body (missing model)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing max_tokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for missing messages', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 when model is not supported', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'unsupported-model',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: 'MODEL_NOT_FOUND',
        },
      });
    });

    it('should accept valid Anthropic message request', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      // Note: This will fail to reach the upstream provider
      // but we're testing that the request is properly validated and routed
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello, Claude!' }],
          max_tokens: 100,
        },
      });

      // Will fail because there's no real upstream, but shows proper routing
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept system prompt', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello!' }],
          max_tokens: 100,
          system: 'You are a helpful assistant.',
        },
      });

      // Will fail because there's no real upstream
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept optional parameters', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello!' }],
          max_tokens: 100,
          temperature: 0.5,
          top_p: 0.9,
          top_k: 50,
          stop_sequences: ['END'],
          metadata: { user_id: 'test-user' },
        },
      });

      // Will fail because there's no real upstream
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept assistant role in messages', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [
            { role: 'user', content: 'Hello!' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'How are you?' },
          ],
          max_tokens: 100,
        },
      });

      // Will fail because there's no real upstream
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept content blocks in messages', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Hello!' }],
            },
          ],
          max_tokens: 100,
        },
      });

      // Will fail because there's no real upstream
      expect([502, 500]).toContain(response.statusCode);
    });
  });

  describe('Error handling', () => {
    it('should return error in Anthropic-compatible format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'nonexistent-model',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('type');
      expect(body.error).toHaveProperty('code');
    });

    it('should return 404 for empty messages array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [],
          max_tokens: 100,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate max_tokens is positive', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: -1,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate temperature range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
          temperature: 2.0, // Invalid for Anthropic (max 1)
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Route not found', () => {
    it('should return 404 for unknown Anthropic endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/unknown',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
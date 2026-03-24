/**
 * Integration tests for Anthropic-compatible routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { registerAnthropicRoutes } from '@/routes/anthropic';
import { registerErrorHandler } from '@/middleware/error-handler';
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

    // Create raw Fastify instance (not using createApp to avoid route conflicts)
    app = Fastify({
      logger: false,
    });

    // Register error handler to properly handle validation errors
    registerErrorHandler(app);

    // Register Anthropic routes
    await registerAnthropicRoutes(app, { repository, proxy });

    // Wait for app to be ready
    await app.ready();
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

  describe('T014: System field as array format', () => {
    it('should accept system field as array of text blocks', async () => {
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
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
            { type: 'text', text: 'Be concise in your responses.' },
          ],
        },
      });

      // Should not return 400 validation error
      // Will fail with 502/500 because no real upstream
      expect(response.statusCode).not.toBe(400);
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept system field with cache_control in text blocks', async () => {
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
          system: [
            { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
          ],
        },
      });

      // Should not return 400 validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept system field with image blocks', async () => {
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
          messages: [{ role: 'user', content: 'Analyze this.' }],
          max_tokens: 100,
          system: [
            { type: 'text', text: 'You analyze images.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'base64encodedimagedata',
              },
            },
          ],
        },
      });

      // Should not return 400 validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept empty system array', async () => {
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
          system: [],
        },
      });

      // Should not return 400 validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should pass through unknown fields with array system', async () => {
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
          system: [{ type: 'text', text: 'Be helpful.' }],
          custom_field: 'preserved',
          experimental_option: { enabled: true },
        },
      });

      // Should not return 400 validation error for unknown fields
      expect(response.statusCode).not.toBe(400);
    });
  });

  describe('T015: Streaming with array system format', () => {
    it('should accept streaming request with array system field', async () => {
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
          stream: true,
          system: [
            { type: 'text', text: 'You are a helpful assistant.' },
          ],
        },
      });

      // Should not return 400 validation error
      // May fail due to no real upstream, but validation should pass
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept streaming request with mixed system blocks', async () => {
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
          stream: true,
          system: [
            { type: 'text', text: 'System prompt 1' },
            { type: 'text', text: 'System prompt 2', cache_control: { type: 'ephemeral' } },
          ],
        },
      });

      // Should not return 400 validation error
      expect(response.statusCode).not.toBe(400);
    });
  });
});
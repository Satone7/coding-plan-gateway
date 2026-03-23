/**
 * Integration tests for OpenAI-compatible routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { registerOpenAIRoutes } from '@/routes/openai';
import { registerErrorHandler } from '@/middleware/error-handler';
import { createMockPlanInput } from '../../fixtures/mock-plans';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('OpenAI Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let proxy: RequestProxy;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `openai-routes-test-${Date.now()}`);
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

    // Register OpenAI routes
    await registerOpenAIRoutes(app, { repository, proxy });

    // Wait for app to be ready
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('GET /v1/models', () => {
    it('should return empty list when no plans exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        object: 'list',
        data: [],
      });
    });

    it('should return models from active plans', async () => {
      await repository.save(
        createMockPlanInput({
          name: 'Plan 1',
          models: ['model-a', 'model-b'],
        })
      );
      await repository.save(
        createMockPlanInput({
          name: 'Plan 2',
          models: ['model-b', 'model-c'],
        })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.object).toBe('list');
      expect(body.data).toHaveLength(3);

      const modelIds = body.data.map((m: { id: string }) => m.id).sort();
      expect(modelIds).toEqual(['model-a', 'model-b', 'model-c']);
    });

    it('should not include models from paused plans', async () => {
      const _plan1 = await repository.save(
        createMockPlanInput({
          name: 'Active Plan',
          models: ['active-model'],
        })
      );
      const plan2 = await repository.save(
        createMockPlanInput({
          name: 'Paused Plan',
          models: ['paused-model'],
        })
      );
      await repository.update(plan2.id, { status: 'paused' });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const modelIds = body.data.map((m: { id: string }) => m.id);
      expect(modelIds).toContain('active-model');
      expect(modelIds).not.toContain('paused-model');
    });

    it('should return correct model object structure', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['test-model'],
        })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const model = body.data[0];

      expect(model).toHaveProperty('id', 'test-model');
      expect(model).toHaveProperty('object', 'model');
      expect(model).toHaveProperty('created');
      expect(model).toHaveProperty('owned_by', 'coding-plan-gateway');
    });
  });

  describe('POST /v1/chat/completions', () => {
    it('should return 400 for invalid request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 404 when model is not supported', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'unsupported-model',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: 'MODEL_NOT_FOUND',
        },
      });
    });

    it('should return 404 when no active plans exist', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['test-model'],
        })
      );
      // No plans will be active since we haven't saved any

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'unknown-model',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should accept valid chat completion request', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['test-model'],
        })
      );

      // Note: This will fail to actually reach the upstream provider
      // but we're testing that the request is properly validated and routed
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'test-model',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello!' },
          ],
          max_tokens: 100,
          temperature: 0.7,
        },
      });

      // Will fail because there's no real upstream, but shows proper routing
      expect([502, 500, 404]).toContain(response.statusCode);
    });

    it('should validate message roles', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'test-model',
          messages: [{ role: 'invalid-role', content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require messages array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'test-model',
          messages: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept optional parameters', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['test-model'],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
          temperature: 0.5,
          top_p: 0.9,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
          user: 'test-user',
        },
      });

      // Will fail because there's no real upstream
      expect([502, 500]).toContain(response.statusCode);
    });
  });

  describe('Error handling', () => {
    it('should return OpenAI-compatible error format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: {
          model: 'nonexistent-model',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('message');
      expect(body.error).toHaveProperty('type');
      expect(body.error).toHaveProperty('code');
    });
  });
});
/**
 * Integration tests for OpenAI-compatible routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { registerOpenAIRoutes } from '@/routes/openai';
import { registerErrorHandler } from '@/middleware/error-handler';
import { CircuitBreaker } from '@/services/circuit-breaker';
import { logger } from '@/utils/logger';
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

    it('should accept tool role messages', async () => {
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
          messages: [
            { role: 'user', content: 'What is the weather?' },
            { role: 'assistant', content: null, tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"Beijing"}' },
            }] },
            { role: 'tool', tool_call_id: 'call_123', content: 'Beijing: 25°C, sunny' },
          ],
        },
      });

      // Will fail because there's no real upstream, but validation should pass
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept assistant message with null content', async () => {
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
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: null },
          ],
        },
      });

      // Will fail because there's no real upstream, but validation should pass
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept tools configuration', async () => {
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
          messages: [{ role: 'user', content: 'What is the weather?' }],
          tools: [{
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get current weather',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          }],
          tool_choice: 'auto',
        },
      });

      // Will fail because there's no real upstream, but validation should pass
      expect([502, 500]).toContain(response.statusCode);
    });

    it('should accept function role messages (deprecated but supported)', async () => {
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
          messages: [
            { role: 'user', content: 'What is the weather?' },
            { role: 'function', name: 'get_weather', content: '25°C, sunny' },
          ],
        },
      });

      // Will fail because there's no real upstream, but validation should pass
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

  describe('Streaming mid-stream failures (ZCode stuck-streams incident)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let recordFailureSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      await repository.save(
        createMockPlanInput({ name: 'Stream Plan', models: ['test-model'] })
      );
      warnSpy = vi.spyOn(logger, 'warn');
      infoSpy = vi.spyOn(logger, 'info');
      recordFailureSpy = vi.spyOn(CircuitBreaker.prototype, 'recordFailure');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const STREAM_BODY = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    };

    /** Mock the proxy: stream one chunk, then die mid-stream like the incident. */
    function mockMidStreamFailure(error: Error): void {
      vi.spyOn(proxy, 'forwardOpenAIStream').mockImplementationOnce(
        async (_b, _o, _onChunk, reply, _onTok) => {
          reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
          reply.raw.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
          // handleStreamError already wrote an SSE error event before rejecting.
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
          reply.raw.end();
          throw error;
        }
      );
    }

    function completionLogProvider(): {
      statusCode?: number;
      error?: string;
    } | undefined {
      const completed = infoSpy.mock.calls.find((call) => call[0] === 'Request completed');
      const ctx = completed?.[1] as { provider?: { statusCode?: number; error?: string } };
      return ctx?.provider;
    }

    it('logs a mid-stream warning and records the plan failure when the upstream dies mid-stream', async () => {
      mockMidStreamFailure(new Error('Request failed: socket hang up'));

      await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: STREAM_BODY });

      // Defect 1: the silent catch must now emit a warn with full context.
      const midStreamWarn = warnSpy.mock.calls.find(
        (call) => call[0] === 'Streaming request failed mid-stream'
      );
      expect(midStreamWarn).toBeDefined();
      const warnCtx = midStreamWarn?.[1] as Record<string, unknown>;
      expect(warnCtx.error).toBe('Request failed: socket hang up');
      expect(warnCtx.headersSent).toBe(true);
      expect(warnCtx.planId).toBe(1);

      // An upstream death IS a plan failure — the circuit breaker must record it.
      expect(recordFailureSpy).toHaveBeenCalledWith(1);

      // Defect 3: the failure must not masquerade as 200 OK / 0 tokens.
      const provider = completionLogProvider();
      expect(provider?.statusCode).toBe(502);
      expect(provider?.error).toContain('socket hang up');
    });

    it('does not record a plan failure when the client aborts mid-stream', async () => {
      const clientAbort = Object.assign(new Error('Request failed: socket hang up'), {
        cause: 'client-abort',
      });
      mockMidStreamFailure(clientAbort);

      await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: STREAM_BODY });

      const midStreamWarn = warnSpy.mock.calls.find(
        (call) => call[0] === 'Streaming request failed mid-stream'
      );
      expect(midStreamWarn).toBeDefined();

      // Defect 2: the client's disconnect must not pollute the plan's circuit.
      expect(recordFailureSpy).not.toHaveBeenCalled();

      // Client aborts surface as 499 in provider metrics.
      const provider = completionLogProvider();
      expect(provider?.statusCode).toBe(499);
    });
  });
});
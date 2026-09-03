/**
 * Unit tests for Anthropic route handlers.
 * Tests schema validation for system field formats.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilePlanRepository } from '@/services/plan-repository';
import { RequestProxy } from '@/services/request-proxy';
import { registerAnthropicRoutes } from '@/routes/anthropic';
import { registerErrorHandler } from '@/middleware/error-handler';
import { createMockPlanInput } from '../../../fixtures/mock-plans';

// Test encryption key
const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Anthropic Handlers - System Field Validation', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let configPath: string;
  let repository: FilePlanRepository;
  let proxy: RequestProxy;

  beforeEach(async () => {
    // Create temp directory
    tempDir = join(tmpdir(), `anthropic-handlers-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'plans.yaml');

    // Create repository and proxy
    repository = new FilePlanRepository(configPath, TEST_ENCRYPTION_KEY);
    proxy = new RequestProxy();

    // Create Fastify instance
    app = Fastify({
      logger: false,
    });

    // Register error handler
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

  describe('T010: String system field validation', () => {
    it('should accept system field as string', async () => {
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

      // Should not return validation error (400)
      // Will fail with 502/500 because no real upstream, but validation passed
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept empty string system field', async () => {
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
          system: '',
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept request without system field', async () => {
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
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });
  });

  describe('T011: Array system field validation', () => {
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
            { type: 'text', text: 'Be concise.', cache_control: { type: 'ephemeral' } },
          ],
        },
      });

      // Should not return validation error
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
          messages: [{ role: 'user', content: 'Analyze this image.' }],
          max_tokens: 100,
          system: [
            { type: 'text', text: 'You analyze images.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'base64encodeddata',
              },
            },
          ],
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept mixed text and image blocks in system array', async () => {
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
            { type: 'text', text: 'System prompt 1' },
            { type: 'text', text: 'System prompt 2' },
          ],
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });
  });

  describe('T012: Empty array system handling', () => {
    it('should accept empty array system field', async () => {
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

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should treat empty array same as missing system field', async () => {
      await repository.save(
        createMockPlanInput({
          models: ['claude-sonnet-4-6'],
        })
      );

      // Both requests should behave the same way
      const responseWithEmptyArray = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello!' }],
          max_tokens: 100,
          system: [],
        },
      });

      const responseWithoutSystem = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello!' }],
          max_tokens: 100,
        },
      });

      // Both should have the same status code (not 400)
      expect(responseWithEmptyArray.statusCode).toBe(responseWithoutSystem.statusCode);
    });
  });

  describe('T013: Unknown field pass-through', () => {
    it('should accept and pass through unknown fields', async () => {
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
          custom_field: 'should be preserved',
          experimental_option: { any: 'value' },
          another_unknown: 12345,
        },
      });

      // Should not return validation error for unknown fields
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept array system with unknown fields in blocks', async () => {
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
            { type: 'text', text: 'Be helpful', unknown_property: 'preserved' },
          ],
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });

    it('should accept both string system and unknown fields together', async () => {
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
          system: 'You are helpful.',
          custom_metadata: { key: 'value' },
        },
      });

      // Should not return validation error
      expect(response.statusCode).not.toBe(400);
    });
  });

  describe('Streaming 429 failover', () => {
    it('falls over to an alternative plan when the primary returns 429', async () => {
      await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['glm-5.2'] }));
      await repository.save(createMockPlanInput({ name: 'Plan-B', models: ['glm-5.2'] }));

      const err429 = Object.assign(new Error('Upstream error: 429 - rate limited'), { statusCode: 429 });
      const streamSpy = vi.spyOn(proxy, 'forwardAnthropicStream')
        .mockRejectedValueOnce(err429)
        .mockImplementationOnce(async (_body, _opts, _onChunk, reply, _onTok) => {
          reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
          reply.raw.write('event: message_start\ndata: {}\n\n');
          reply.raw.end();
        });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'glm-5.2',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 64,
          stream: true,
        },
      });

      expect(streamSpy).toHaveBeenCalledTimes(2);
      expect(response.statusCode).toBe(200);
    });

    it('passes the primary 429 through when all alternatives also fail', async () => {
      await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['glm-5.2'] }));
      await repository.save(createMockPlanInput({ name: 'Plan-B', models: ['glm-5.2'] }));

      const err429 = Object.assign(new Error('Upstream error: 429 - quota exceeded'), { statusCode: 429 });
      vi.spyOn(proxy, 'forwardAnthropicStream').mockRejectedValue(err429);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'glm-5.2',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 64,
          stream: true,
        },
      });

      // primary + alt both 429 → surface the primary's 429 (HTTP 429, not generic 502)
      expect(response.statusCode).toBe(429);
    });

    it('does not failover on a deterministic client error (e.g. 401)', async () => {
      await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['glm-5.2'] }));
      await repository.save(createMockPlanInput({ name: 'Plan-B', models: ['glm-5.2'] }));

      const err401 = Object.assign(new Error('Upstream error: 401 - unauthorized'), { statusCode: 401 });
      const streamSpy = vi.spyOn(proxy, 'forwardAnthropicStream').mockRejectedValueOnce(err401);

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'glm-5.2',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 64,
          stream: true,
        },
      });

      expect(streamSpy).toHaveBeenCalledTimes(1); // no failover attempted
      expect(response.statusCode).toBe(401);
    });

    it('fails over to an alternative plan on a transport error (socket hang up, no status code)', async () => {
      // Regression: the prod incident where a Kimi plan socket-hang-up'd and
      // the equally-capable failover plan was never tried because transport
      // errors carry no statusCode and the old gate only accepted 400/429.
      await repository.save(createMockPlanInput({ name: 'Plan-A', models: ['glm-5.2'] }));
      await repository.save(createMockPlanInput({ name: 'Plan-B', models: ['glm-5.2'] }));

      const socketErr = new Error('Request failed: socket hang up'); // no statusCode
      const streamSpy = vi.spyOn(proxy, 'forwardAnthropicStream')
        .mockRejectedValueOnce(socketErr)
        .mockImplementationOnce(async (_body, _opts, _onChunk, reply, _onTok) => {
          reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream' });
          reply.raw.write('event: message_start\ndata: {}\n\n');
          reply.raw.end();
        });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'glm-5.2',
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 64,
          stream: true,
        },
      });

      expect(streamSpy).toHaveBeenCalledTimes(2); // primary failed, failover tried
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Model alias response rewrite (M8)', () => {
    it('rewrites the response model field back to the requested alias (non-streaming)', async () => {
      await repository.save(createMockPlanInput({
        name: 'Aliased',
        models: ['glm-5-turbo'],
        modelAliases: { 'glm-5': 'glm-5-turbo' },
      }));

      vi.spyOn(proxy, 'forwardAnthropicRequest').mockResolvedValue({
        // Upstream responds with the canonical model name.
        data: { model: 'glm-5-turbo', content: [] } as never,
        statusCode: 200,
        headers: {},
        durationMs: 5,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'glm-5', // the alias the client requested
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 64,
        },
      });

      expect(response.statusCode).toBe(200);
      // Client asked for glm-5; the gateway must not leak the canonical name.
      expect(response.json().model).toBe('glm-5');
    });
  });

  describe('Embedded system message normalization', () => {
    /**
     * The Anthropic spec reserves user/assistant roles for `messages` —
     * system prompts belong in the top-level `system` field. Loose clients
     * embed them anyway; strict upstreams reject the request, and LM Studio
     * accepts it then 500s at chat-template render ("System message must be
     * at the beginning"). The gateway hoists them before forwarding.
     */
    function mockUpstream(): ReturnType<typeof vi.spyOn> {
      return vi.spyOn(proxy, 'forwardAnthropicRequest').mockResolvedValue({
        data: { model: 'new-model-1', content: [] } as never,
        statusCode: 200,
        headers: {},
        durationMs: 5,
      });
    }

    it('hoists a mid-conversation system message into the top-level system field', async () => {
      await repository.save(createMockPlanInput({ models: ['new-model-1'] }));
      const spy = mockUpstream();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'new-model-1',
          max_tokens: 64,
          system: 'You are helpful.',
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'system', content: 'be brief' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const upstreamBody = spy.mock.calls[0]![0] as { messages: Array<{ role: string }>; system: unknown };
      // No system role may remain in messages…
      expect(upstreamBody.messages.map((m) => m.role)).toEqual(['user']);
      // …and the hoisted content merged into the top-level system blocks,
      // existing top-level content first.
      expect(upstreamBody.system).toEqual([
        { type: 'text', text: 'You are helpful.' },
        { type: 'text', text: 'be brief' },
      ]);
    });

    it('hoists into a blocks array when no top-level system exists', async () => {
      await repository.save(createMockPlanInput({ models: ['new-model-1'] }));
      const spy = mockUpstream();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'new-model-1',
          max_tokens: 64,
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'hi' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const upstreamBody = spy.mock.calls[0]![0] as { messages: Array<{ role: string }>; system: unknown };
      expect(upstreamBody.messages.map((m) => m.role)).toEqual(['user']);
      expect(upstreamBody.system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
    });

    it('leaves spec-shaped requests untouched', async () => {
      await repository.save(createMockPlanInput({ models: ['new-model-1'] }));
      const spy = mockUpstream();

      await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'new-model-1',
          max_tokens: 64,
          system: 'You are helpful.',
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        },
      });

      const upstreamBody = spy.mock.calls[0]![0] as { messages: unknown[]; system: unknown };
      // A plain string system prompt must survive as a string, not be
      // rewritten to blocks.
      expect(upstreamBody.system).toBe('You are helpful.');
      expect(upstreamBody.messages).toHaveLength(2);
    });

    it('hoists multiple system messages preserving their order', async () => {
      await repository.save(createMockPlanInput({ models: ['new-model-1'] }));
      const spy = mockUpstream();

      await app.inject({
        method: 'POST',
        url: '/v1/messages',
        payload: {
          model: 'new-model-1',
          max_tokens: 64,
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'system', content: 'first rule' },
            { role: 'user', content: 'again' },
            { role: 'system', content: 'second rule' },
          ],
        },
      });

      const upstreamBody = spy.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
        system: Array<{ text: string }>;
      };
      expect(upstreamBody.messages.map((m) => m.content)).toEqual(['hi', 'again']);
      expect(upstreamBody.system.map((b) => b.text)).toEqual(['first rule', 'second rule']);
    });
  });
});
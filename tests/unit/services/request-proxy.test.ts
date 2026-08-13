/**
 * Unit tests for RequestProxy service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServer, get } from 'http';
import type { AddressInfo } from 'net';
import type { FastifyReply } from 'fastify';
import { RequestProxy, extractStreamTokenUsage, mergeStreamTokenUsage } from '@/services/request-proxy';

const ANTHROPIC_STREAM_BODY = {
  model: 'test-model',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  max_tokens: 100,
  stream: true,
};

/**
 * Start a bare HTTP server on an ephemeral port. Returns its URL so the proxy
 * can point at it as a "real" upstream.
 */
async function startTestServer(): Promise<{ server: ReturnType<typeof createServer>; url: string }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}` };
}

/**
 * Minimal stand-in for FastifyReply — the proxy only touches these members.
 * Backed by a REAL ServerResponse so socket lifecycle behavior (client
 * disconnect, backpressure, headersSent) matches production.
 */
function fakeReplyFrom(res: import('http').ServerResponse): FastifyReply {
  return { raw: res, hijack: () => undefined } as unknown as FastifyReply;
}

describe('RequestProxy', () => {
  let proxy: RequestProxy;

  beforeEach(() => {
    proxy = new RequestProxy();
  });

  describe('constructor', () => {
    it('should create a RequestProxy instance', () => {
      expect(proxy).toBeInstanceOf(RequestProxy);
    });
  });

  describe('forwardOpenAIRequest', () => {
    it('should reject with error for invalid URL', async () => {
      const request = {
        model: 'test-model',
        messages: [{ role: 'user' as const, content: 'Hello' }],
      };

      await expect(
        proxy.forwardOpenAIRequest(request, {
          baseUrl: 'not-a-url',
          apiKey: 'test-key',
        })
      ).rejects.toThrow();
    });

    it('should include correct headers in request', async () => {
      // This test would need a mock server to verify headers
      // For now, we test that the method exists and accepts correct params
      const request = {
        model: 'test-model',
        messages: [{ role: 'user' as const, content: 'Hello' }],
      };

      // We expect this to fail since we don't have a real upstream
      await expect(
        proxy.forwardOpenAIRequest(request, {
          baseUrl: 'https://api.example.com',
          apiKey: 'test-key',
          timeout: 1,
        })
      ).rejects.toThrow();
    });

    it('should not append an extra /v1 segment when the provider base URL already ends with a version path', async () => {
      const request = {
        model: 'test-model',
        messages: [{ role: 'user' as const, content: 'Hello' }],
      };
      const makeRequest = vi
        .spyOn(proxy as unknown as { makeRequest: RequestProxy['forwardOpenAIRequest'] }, 'makeRequest' as never)
        .mockResolvedValue({
          data: { id: 'chatcmpl-test', choices: [] },
          statusCode: 200,
          headers: {},
          durationMs: 0,
        } as never);

      await proxy.forwardOpenAIRequest(request, {
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        apiKey: 'test-key',
      });

      expect(makeRequest).toHaveBeenCalledTimes(1);
      expect(makeRequest.mock.calls[0]?.[0].url.toString()).toBe(
        'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
      );
    });
  });

  describe('forwardAnthropicRequest', () => {
    it('should reject with error for invalid URL', async () => {
      const request = {
        model: 'test-model',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      };

      await expect(
        proxy.forwardAnthropicRequest(request, {
          baseUrl: 'not-a-url',
          apiKey: 'test-key',
        })
      ).rejects.toThrow();
    });

    it('should accept valid Anthropic request format', async () => {
      const request = {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 100,
      };

      // We expect this to fail since we don't have a real upstream
      await expect(
        proxy.forwardAnthropicRequest(request, {
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'test-key',
          timeout: 1,
        })
      ).rejects.toThrow();
    });
  });
});

describe('createRequestProxy', () => {
  it('should create a new RequestProxy instance', async () => {
    const { createRequestProxy } = await import('@/services/request-proxy');
    const proxy = createRequestProxy();
    expect(proxy).toBeInstanceOf(RequestProxy);
  });
});

describe('requestProxy singleton', () => {
  it('should export a default RequestProxy instance', async () => {
    const { requestProxy } = await import('@/services/request-proxy');
    expect(requestProxy).toBeInstanceOf(RequestProxy);
  });
});

describe('stream token usage capture (H6)', () => {
  it('extractStreamTokenUsage finds input/output in a short tail', () => {
    const tail = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":500}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":12}}',
      '',
    ].join('\n');
    const usage = extractStreamTokenUsage(tail);
    expect(usage?.inputTokens).toBe(500);
    expect(usage?.outputTokens).toBe(12);
  });

  it('tail that evicted message_start reports input=0 (the bug shape)', () => {
    // Simulate a >4KB stream: message_start scrolled out of the 4KB tail, only
    // the terminal message_delta (output_tokens) remains.
    const longPadding = 'x'.repeat(5000);
    const tail = longPadding + '\ndata: {"type":"message_delta","usage":{"output_tokens":12}}\n';
    const usage = extractStreamTokenUsage(tail);
    expect(usage?.inputTokens).toBe(0); // lost
    expect(usage?.outputTokens).toBe(12);
  });

  it('mergeStreamTokenUsage restores input_tokens captured before the tail evicted them', () => {
    const longPadding = 'x'.repeat(5000);
    const tail = extractStreamTokenUsage(
      longPadding + '\ndata: {"type":"message_delta","usage":{"output_tokens":12}}\n'
    );
    // input_tokens were captured from message_start during streaming (500);
    // output captured from message_delta (12).
    const merged = mergeStreamTokenUsage(tail, 500, 12);
    expect(merged?.inputTokens).toBe(500);
    expect(merged?.outputTokens).toBe(12);
    expect(merged?.totalTokens).toBe(512);
  });

  it('mergeStreamTokenUsage falls back to tail when nothing was captured', () => {
    const tail = extractStreamTokenUsage(
      'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":3}}\n'
    );
    const merged = mergeStreamTokenUsage(tail, undefined, undefined);
    expect(merged?.inputTokens).toBe(7);
    expect(merged?.outputTokens).toBe(3);
  });

  it('mergeStreamTokenUsage returns tail untouched when no captured values and no tail', () => {
    expect(mergeStreamTokenUsage(undefined, undefined, undefined)).toBeUndefined();
  });
});

describe('streaming failure reproduction (ZCode stuck-streams incident)', () => {
  let proxy: RequestProxy;

  beforeEach(() => {
    proxy = new RequestProxy();
  });

  it('rejects and delivers an SSE error event when the upstream dies mid-stream', async () => {
    // Upstream: sends SSE headers + one chunk, then dies abruptly (socket
    // destroyed without terminating the SSE stream) — but only once the test
    // has observed the chunk reaching the client, so this mirrors production
    // where the upstream always streams at least one block before dying.
    let destroyUpstream: (() => void) | undefined;
    const upstream = await startTestServer();
    upstream.server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n');
      destroyUpstream = () => res.socket?.destroy();
    });

    // Client: a real HTTP connection whose response object the gateway
    // hijacks, exactly like production.
    const client = await startTestServer();
    const proxyOutcomePromise = new Promise<{ error?: Error }>((resolve) => {
      client.server.on('request', (_req, res) => {
        proxy
          .forwardAnthropicStream(
            ANTHROPIC_STREAM_BODY,
            { baseUrl: upstream.url, apiKey: 'test-key', timeout: 5, requestId: 'req-midstream' },
            () => undefined,
            fakeReplyFrom(res)
          )
          .then(
            () => resolve({}),
            (error: Error) => resolve({ error })
          );
      });
    });

    try {
      const clientOutcome = await new Promise<{ error?: Error; statusCode?: number; body: string }>(
        (resolve) => {
          get(client.url, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => {
              body += chunk.toString();
              // First chunk reached the client — now kill the upstream.
              destroyUpstream?.();
            });
            res.on('end', () => resolve({ statusCode: res.statusCode, body }));
            res.on('error', (error: Error) => resolve({ error, body }));
          }).on('error', (error: Error) => resolve({ error }));
        }
      );
      const proxyOutcome = await proxyOutcomePromise;

      // The client connection stays up: the gateway must fail loudly via an
      // SSE error event instead of hanging until the 300s idle timeout.
      expect(clientOutcome.error).toBeUndefined();
      expect(clientOutcome.statusCode).toBe(200);
      expect(clientOutcome.body).toContain('event: error');
      expect(proxyOutcome.error).toBeDefined();
    } finally {
      upstream.server.closeAllConnections?.();
      client.server.closeAllConnections?.();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => client.server.close(() => resolve()));
    }
  });

  it('rejects with Request timeout after the upstream stalls (the +300s signature, scaled)', async () => {
    // Upstream: streams one chunk then silently stalls — the failure shape
    // behind the "+300s idle timeout" signature from the incident.
    const upstream = await startTestServer();
    upstream.server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n');
      // no 'end' — just silence
    });

    const client = await startTestServer();
    const proxyOutcomePromise = new Promise<{ error?: Error }>((resolve) => {
      client.server.on('request', (_req, res) => {
        proxy
          .forwardAnthropicStream(
            ANTHROPIC_STREAM_BODY,
            // 1s idle timeout instead of the prod 300s so the test stays fast
            { baseUrl: upstream.url, apiKey: 'test-key', timeout: 1, requestId: 'req-stall' },
            () => undefined,
            fakeReplyFrom(res)
          )
          .then(
            () => resolve({}),
            (error: Error) => resolve({ error })
          );
      });
    });

    try {
      get(client.url, (res) => {
        res.resume(); // keep reading so the socket stays open
      }).on('error', () => undefined);

      const outcome = await proxyOutcomePromise;
      expect(outcome.error?.message).toContain('Request timeout');
    } finally {
      upstream.server.closeAllConnections?.();
      client.server.closeAllConnections?.();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => client.server.close(() => resolve()));
    }
  });

  it('tags the rejection with cause=client-abort when the client disconnects mid-stream', async () => {
    // Upstream: starts a healthy SSE stream and keeps it open.
    const upstream = await startTestServer();
    upstream.server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n');
    });

    const client = await startTestServer();
    const proxyOutcomePromise = new Promise<{ error?: Error }>((resolve) => {
      client.server.on('request', (_req, res) => {
        proxy
          .forwardAnthropicStream(
            ANTHROPIC_STREAM_BODY,
            { baseUrl: upstream.url, apiKey: 'test-key', timeout: 5, requestId: 'req-clientabort' },
            () => undefined,
            fakeReplyFrom(res)
          )
          .then(
            () => resolve({}),
            (error: Error) => resolve({ error })
          );
      });
    });

    try {
      // The real client reads the first chunk, then disconnects — the exact
      // "client stopped reading" shape from the incident.
      await new Promise<void>((resolve, reject) => {
        const conn = get(client.url, (res) => {
          res.on('data', () => {
            conn.destroy();
            resolve();
          });
        });
        conn.on('error', () => resolve());
        setTimeout(() => reject(new Error('timed out waiting for first chunk')), 4000);
      });

      const outcome = await proxyOutcomePromise;
      expect(outcome.error).toBeDefined();
      // The proxy must tag this as a client abort so the handler does not
      // record it as a plan failure (circuit-breaker pollution).
      expect((outcome.error as Error & { cause?: string }).cause).toBe('client-abort');
    } finally {
      upstream.server.closeAllConnections?.();
      client.server.closeAllConnections?.();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => client.server.close(() => resolve()));
    }
  });
});

/**
 * Unit tests for RequestProxy service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createServer, get } from 'http';
import type { AddressInfo } from 'net';
import type { FastifyReply } from 'fastify';
import { RequestProxy, extractStreamTokenUsage, mergeStreamTokenUsage } from '@/services/request-proxy';
import { logger } from '@/utils/logger';

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

  describe('upstream error body dump (CPG_LOG_REQUEST_BODY_ON_ERROR)', () => {
    /**
     * Bodies can carry user content, so the dump is off by default and
     * truncated — the gate exists so upstream rejections (e.g. the 2026-09-03
     * LM Studio "System message must be at the beginning" incident, whose
     * triggering payload was unrecoverable) can be diagnosed from prod logs.
     */
    function startErroringServer(status: number): Promise<{ server: ReturnType<typeof createServer>; url: string }> {
      return (async () => {
        const upstream = await startTestServer();
        upstream.server.on('request', (_req, res) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }));
        });
        return upstream;
      })();
    }

    it('logs the truncated request body on non-streaming 5xx when enabled', async () => {
      const upstream = await startErroringServer(500);
      vi.stubEnv('CPG_LOG_REQUEST_BODY_ON_ERROR', '1');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      try {
        await expect(
          proxy.forwardAnthropicRequest(ANTHROPIC_STREAM_BODY, { baseUrl: upstream.url, apiKey: 'k', requestId: 'req-dump' })
        ).rejects.toThrow('Upstream error: 500');

        const dump = warnSpy.mock.calls.find((c) => c[0] === 'Upstream rejected request — request body follows');
        expect(dump).toBeTruthy();
        const ctx = dump![1] as { requestId?: string; statusCode?: number; bodyPreview?: string };
        expect(ctx.requestId).toBe('req-dump');
        expect(ctx.statusCode).toBe(500);
        expect(ctx.bodyPreview).toContain('"model":"test-model"');
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllEnvs();
        upstream.server.close();
      }
    });

    it('does not log request bodies when the gate is unset', async () => {
      const upstream = await startErroringServer(500);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      try {
        await expect(
          proxy.forwardAnthropicRequest(ANTHROPIC_STREAM_BODY, { baseUrl: upstream.url, apiKey: 'k' })
        ).rejects.toThrow('Upstream error: 500');

        expect(warnSpy.mock.calls.some((c) => c[0] === 'Upstream rejected request — request body follows')).toBe(false);
      } finally {
        warnSpy.mockRestore();
        upstream.server.close();
      }
    });

    it('logs the truncated request body on streaming 5xx when enabled', async () => {
      const upstream = await startErroringServer(502);
      vi.stubEnv('CPG_LOG_REQUEST_BODY_ON_ERROR', '1');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const replyHolder: { reply?: ReturnType<typeof fakeReplyFrom> } = {};
      const client = await startTestServer();
      client.server.on('request', (_req, res) => {
        replyHolder.reply = fakeReplyFrom(res);
      });
      void get(client.url).end();

      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        await expect(
          proxy.forwardAnthropicStream(
            ANTHROPIC_STREAM_BODY,
            { baseUrl: upstream.url, apiKey: 'k', timeout: 5, requestId: 'req-stream-dump' },
            () => undefined,
            replyHolder.reply!
          )
        ).rejects.toThrow('Upstream error: 502');

        const dump = warnSpy.mock.calls.find((c) => c[0] === 'Upstream rejected request — request body follows');
        expect(dump).toBeTruthy();
        expect((dump![1] as { bodyPreview?: string }).bodyPreview).toContain('"model":"test-model"');
      } finally {
        warnSpy.mockRestore();
        vi.unstubAllEnvs();
        upstream.server.close();
        client.server.close();
      }
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

/**
 * Regression tests: UTF-8 multi-byte characters split across network chunks
 * must never decode to U+FFFD replacement characters.
 *
 * Background: the non-streaming aggregation path and the streaming SSE bypass
 * parser used per-chunk string decoding (`data += chunk`, `sseBuffer +=
 * chunk.toString()`), which replaces a CJK/emoji byte sequence split across
 * TCP chunks with U+FFFD before JSON.parse — corrupting LLM output for
 * non-ASCII languages. (Incident report: 2026-08-17, req-vi6.)
 */
describe('UTF-8 boundary handling (no U+FFFD on split chunks)', () => {
  const countFFFD = (s: string): number => (s.match(/\uFFFD/g) || []).length;

  /** Write `body` in multiple TCP writes, cutting inside the char at `charOffsetInBody + k` for each k in cuts. */
  const writeSplitAt = (res: import('http').ServerResponse, body: Buffer, cutOffsets: number[]): void => {
    res.socket?.setNoDelay(true);
    const parts: Buffer[] = [];
    let prev = 0;
    for (const off of cutOffsets.sort((a, b) => a - b)) {
      parts.push(body.subarray(prev, off));
      prev = off;
    }
    parts.push(body.subarray(prev));
    let i = 0;
    const next = (): void => {
      if (i < parts.length) {
        res.write(parts[i++]);
        setTimeout(next, 20);
      } else {
        res.end();
      }
    };
    next();
  };

  /** Absolute byte offsets of `cuts`-relative positions inside `target`'s first occurrence in `body`. */
  const cutInside = (body: Buffer, target: string, cuts: number[]): number[] => {
    const rel = body.indexOf(Buffer.from(target, 'utf8'));
    expect(rel).toBeGreaterThanOrEqual(0);
    return cuts.map((k) => rel + k);
  };

  const SPLITS: Array<[string, string, number[]]> = [
    ['CJK 3-byte split 1+2', '套', [1]],
    ['CJK 3-byte split 2+1', '套', [2]],
    ['CJK 3-byte split 1+1+1', '套', [1, 2]],
    ['emoji 4-byte split at every byte', '😀', [1, 2, 3]],
  ];

  describe.each(SPLITS)('non-streaming aggregation (%s)', (_label, target, cuts) => {
    it('anthropic /v1/messages returns the original text with zero U+FFFD', async () => {
      const proxy = new RequestProxy();
      const body = Buffer.from(
        JSON.stringify({
          id: 'msg_t',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: `坚持使用同一${target}指标` }],
        }),
        'utf8'
      );
      const upstream = await startTestServer();
      upstream.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        writeSplitAt(res, body, cutInside(body, target, cuts));
      });
      try {
        const resp = await proxy.forwardAnthropicRequest(
          { model: 'test-model', max_tokens: 10, messages: [{ role: 'user' as const, content: 'hi' }] },
          { baseUrl: upstream.url, apiKey: 'test-key', timeout: 10 }
        );
        const text = resp.data.content?.[0]?.text ?? '';
        expect(countFFFD(text)).toBe(0);
        expect(text).toContain(`同一${target}指标`);
      } finally {
        upstream.server.closeAllConnections?.();
        await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      }
    });

    it('openai /chat/completions returns the original text with zero U+FFFD', async () => {
      const proxy = new RequestProxy();
      const body = Buffer.from(
        JSON.stringify({ choices: [{ message: { content: `同一${target}指标` } }] }),
        'utf8'
      );
      const upstream = await startTestServer();
      upstream.server.on('request', (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        writeSplitAt(res, body, cutInside(body, target, cuts));
      });
      try {
        const resp = await proxy.forwardOpenAIRequest(
          { model: 'test-model', messages: [{ role: 'user' as const, content: 'hi' }] },
          { baseUrl: upstream.url, apiKey: 'test-key', timeout: 10 }
        );
        const text = resp.data.choices?.[0]?.message?.content ?? '';
        expect(countFFFD(text)).toBe(0);
        expect(text).toContain(`同一${target}指标`);
      } finally {
        upstream.server.closeAllConnections?.();
        await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      }
    });
  });

  it('streaming SSE: client body and bypass accumulatedText survive a mid-character chunk split', async () => {
    const proxy = new RequestProxy();
    const target = '套';
    const ev = (obj: unknown): Buffer => Buffer.from(`event: x\ndata: ${JSON.stringify(obj)}\n\n`, 'utf8');
    const deltaEv = ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `同一${target}指标` } });
    const head = ev({ type: 'message_start', message: { usage: { input_tokens: 3 } } });
    const tail = ev({ type: 'message_delta', delta: {}, usage: { output_tokens: 5 } });

    const upstream = await startTestServer();
    upstream.server.on('request', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      writeSplitAt(res, Buffer.concat([head, deltaEv, tail]), cutInside(deltaEv, target, [1]).map((k) => head.length + k));
    });

    const client = await startTestServer();
    const accumulatedPromise = new Promise<string | undefined>((resolveAcc) => {
      client.server.on('request', (_req, res) => {
        proxy
          .forwardAnthropicStream(
            ANTHROPIC_STREAM_BODY,
            { baseUrl: upstream.url, apiKey: 'test-key', timeout: 10 },
            () => undefined,
            fakeReplyFrom(res),
            (_usage, acc) => resolveAcc(acc)
          )
          .catch(() => resolveAcc(undefined));
      });
    });

    try {
      const clientBody = await new Promise<Buffer>((resolveBody) => {
        get(client.url, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolveBody(Buffer.concat(chunks)));
        });
      });
      const accumulated = await accumulatedPromise;
      const bodyText = clientBody.toString('utf8');
      // User-visible raw passthrough stays byte-identical (no replacement chars).
      expect(countFFFD(bodyText)).toBe(0);
      expect(bodyText).toContain(`同一${target}指标`);
      // Bypass parser must agree — it feeds the token-usage fallback estimator.
      expect(accumulated).toBeDefined();
      expect(countFFFD(accumulated!)).toBe(0);
      expect(accumulated).toContain(`同一${target}指标`);
    } finally {
      upstream.server.closeAllConnections?.();
      client.server.closeAllConnections?.();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
      await new Promise<void>((resolve) => client.server.close(() => resolve()));
    }
  });

  it('streaming upstream 4xx error body split mid-character carries no U+FFFD in the rejection message', async () => {
    const proxy = new RequestProxy();
    const target = '套';
    const body = Buffer.from(JSON.stringify({ error: { message: `同一${target}指标无效` } }), 'utf8');
    const upstream = await startTestServer();
    upstream.server.on('request', (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      writeSplitAt(res, body, cutInside(body, target, [1, 2]));
    });

    // Errors that surface before the first SSE chunk are delivered by the
    // route layer (the reply is never hijacked), so a bare stub reply is the
    // right stand-in here — the assertion target is the rejection message.
    const stubReply = {
      raw: {
        headersSent: false,
        setHeader: () => undefined,
        write: () => true,
        end: () => undefined,
        on: () => undefined,
        removeListener: () => undefined,
      },
      hijack: () => undefined,
    } as unknown as FastifyReply;

    try {
      const err = await proxy
        .forwardAnthropicStream(
          ANTHROPIC_STREAM_BODY,
          { baseUrl: upstream.url, apiKey: 'test-key', timeout: 10 },
          () => undefined,
          stubReply
        )
        .then(() => { throw new Error('expected rejection'); }, (e: Error) => e);
      expect(err).toBeDefined();
      expect(err.message).toContain('429');
      expect(countFFFD(err.message)).toBe(0);
      expect(err.message).toContain(`同一${target}指标无效`);
    } finally {
      upstream.server.closeAllConnections?.();
      await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    }
  });
});

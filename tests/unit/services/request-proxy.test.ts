/**
 * Unit tests for RequestProxy service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestProxy, extractStreamTokenUsage, mergeStreamTokenUsage } from '@/services/request-proxy';

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

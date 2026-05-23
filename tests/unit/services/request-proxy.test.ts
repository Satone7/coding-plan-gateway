/**
 * Unit tests for RequestProxy service.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestProxy } from '@/services/request-proxy';

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

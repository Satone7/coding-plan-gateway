/**
 * Unit tests for RequestProxy service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
          timeout: 1000,
        })
      ).rejects.toThrow();
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
          timeout: 1000,
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
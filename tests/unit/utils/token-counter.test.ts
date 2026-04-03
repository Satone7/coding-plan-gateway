import { describe, it, expect, vi } from 'vitest';
import { TokenCounter } from '@/utils/token-counter';
import { AnthropicMessageRequest } from '@/types/anthropic';
import { ChatCompletionRequest } from '@/types/openai';

// Mock the tokenizer to avoid loading the actual model during tests
vi.mock('@anthropic-ai/tokenizer', () => ({
  countTokens: vi.fn().mockImplementation((text: string) => {
    if (text.includes('throw error')) {
      throw new Error('Tokenizer failed');
    }
    return text.length; // Simple mock: 1 char = 1 token
  }),
}));

describe('TokenCounter', () => {
  describe('estimateAnthropicInputTokens', () => {
    it('should count tokens for string messages', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        system: 'You are a helpful assistant\n',
        messages: [
          { role: 'user', content: 'Hello world\n' },
          { role: 'assistant', content: 'Hi there\n' },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      // 'You are a helpful assistant\n\n' (29) + 'Hello world\n\n' (13) + 'Hi there\n\n' (10) = 52
      expect(tokens).toBe(52);
    });

    it('should count tokens for array messages with text and images', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this image\n' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '...' } },
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      // 'Analyze this image\n\n' (20) + 1000 (image fallback) = 1020
      expect(tokens).toBe(1020);
    });

    it('should count tokens for documents', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'abcd' } } as any,
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      // 'abcd' length 4 / 4 = 1 token
      expect(tokens).toBe(1);
    });

    it('should handle tokenizer failures by using length/4 estimation', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'throw error' }],
      };
      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      // 'throw error\n' = 12 chars, ceil(12/4) = 3
      expect(tokens).toBe(3);
    });
  });

  describe('estimateOpenAIInputTokens', () => {
    it('should count tokens for string messages', () => {
      const request: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a bot\n' },
          { role: 'user', content: 'Hello\n' },
        ],
      };

      const tokens = TokenCounter.estimateOpenAIInputTokens(request);
      // 'You are a bot\n\n' (15) + 'Hello\n\n' (7) = 22
      expect(tokens).toBe(22);
    });

    it('should count tokens for multimodal messages', () => {
      const request: ChatCompletionRequest = {
        model: 'gpt-4-vision',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this\n' },
              { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateOpenAIInputTokens(request);
      // 'Look at this\n\n' (14) + 1000 (image fallback) = 1014
      expect(tokens).toBe(1014);
    });
  });

  describe('estimateOutputTokens', () => {
    it('should count output tokens for text', () => {
      expect(TokenCounter.estimateOutputTokens('Hello world')).toBe(11); // 11 chars
    });

    it('should return 0 for empty text', () => {
      expect(TokenCounter.estimateOutputTokens('')).toBe(0);
    });
  });

  describe('buildTokenUsageWithFallback', () => {
    it('should return the original usage if totalTokens exists', () => {
      const usage = { totalTokens: 100, inputTokens: 40, outputTokens: 60 };
      const result = TokenCounter.buildTokenUsageWithFallback(usage, {}, 'openai', undefined, 'req-1');
      expect(result).toEqual({ totalTokens: 100, inputTokens: 40, outputTokens: 60 });
    });

    it('should handle missing input/output tokens if total exists', () => {
      const usage = { totalTokens: 100 };
      const result = TokenCounter.buildTokenUsageWithFallback(usage, {}, 'openai', undefined, 'req-1');
      expect(result).toEqual({ totalTokens: 100, inputTokens: 0, outputTokens: 0 });
    });

    it('should fallback to local estimation if totalTokens is missing and accumulated text is provided', () => {
      const request: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'prompt' }],
      };
      
      const result = TokenCounter.buildTokenUsageWithFallback(undefined, request, 'openai', 'response', 'req-1');
      
      // prompt\n = 7, response = 8
      expect(result).toEqual({
        inputTokens: 7,
        outputTokens: 8,
        totalTokens: 15,
      });
    });

    it('should return undefined if no usage and no accumulated text', () => {
      const result = TokenCounter.buildTokenUsageWithFallback(undefined, {}, 'openai', undefined, 'req-1');
      expect(result).toBeUndefined();
    });
  });
});
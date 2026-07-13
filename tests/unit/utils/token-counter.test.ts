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
      
      const expectedTokens = 
        'You are a helpful assistant\n\n'.length + 
        'Hello world\n\n'.length + 
        'Hi there\n\n'.length;
        
      expect(tokens).toBe(expectedTokens);
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
      const expectedTokens = 'Analyze this image\n\n'.length + 1000;
      expect(tokens).toBe(expectedTokens);
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
      const expectedTokens = Math.ceil('abcd'.length / 4);
      expect(tokens).toBe(expectedTokens);
    });

    it('should handle tokenizer failures by using length/4 estimation', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'throw error' }],
      };
      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      const expectedTokens = Math.ceil('throw error\n'.length / 4);
      expect(tokens).toBe(expectedTokens);
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
      const expectedTokens = 'You are a bot\n\n'.length + 'Hello\n\n'.length;
      expect(tokens).toBe(expectedTokens);
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
      const expectedTokens = 'Look at this\n\n'.length + 1000;
      expect(tokens).toBe(expectedTokens);
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

    it('should fallback to local estimation if tokenUsage has totalTokens=0 (false positive from stream extraction)', () => {
      const request: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello world' }],
      };

      // When extractStreamTokenUsage returns {totalTokens: 0, inputTokens: 0, outputTokens: 0}
      // due to matching a zero value in the stream tail, the fallback should still kick in.
      const zeroUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
      const result = TokenCounter.buildTokenUsageWithFallback(zeroUsage, request, 'openai', 'response', 'req-1');

      // hello world\n = 12 tokens, response = 8 tokens, total = 20
      expect(result).toEqual({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      });
    });

    it('should return undefined if no usage and no accumulated text', () => {
      const result = TokenCounter.buildTokenUsageWithFallback(undefined, {}, 'openai', undefined, 'req-1');
      expect(result).toBeUndefined();
    });
  });
});

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
        'You are a helpful assistant\n'.length +
        '\nHello world\n'.length +
        '\nHi there\n'.length;

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
      const expectedTokens = 'Analyze this image\n'.length + 1000;
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
      const expectedTokens = Math.ceil('throw error'.length / 4);
      expect(tokens).toBe(expectedTokens);
    });

    it('should count tool_use blocks (input JSON + tool name)', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Read',
                input: { file_path: '/src/index.ts' },
              },
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      const expectedTokens = JSON.stringify({ file_path: '/src/index.ts' }).length + '\nRead'.length;
      expect(tokens).toBe(expectedTokens);
    });

    it('should count tool_result blocks with string content', () => {
      const fileBody = 'const x = 1;\n'.repeat(100); // 1300 chars of tool output
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: fileBody }],
          },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      expect(tokens).toBe(fileBody.length);
    });

    it('should count tool_result blocks with structured content', () => {
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [
                  { type: 'text', text: 'first part' },
                  { type: 'text', text: 'second part' },
                ],
              },
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      const expectedTokens = 'first part'.length + '\nsecond part'.length;
      expect(tokens).toBe(expectedTokens);
    });

    it('should count tool definitions', () => {
      const tool = { name: 'Read', description: 'Read a file', input_schema: { type: 'object' } };
      const request: AnthropicMessageRequest = {
        model: 'claude-3-opus',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'hi' }],
        tools: [tool],
      };

      const tokens = TokenCounter.estimateAnthropicInputTokens(request);
      const expectedTokens = 'hi'.length + '\n'.length + JSON.stringify(tool).length;
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
      const expectedTokens = 'You are a bot\n'.length + '\nHello\n'.length;
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
      const expectedTokens = 'Look at this\n'.length + 1000;
      expect(tokens).toBe(expectedTokens);
    });

    it('should count tool_calls arguments and function names', () => {
      const request: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
        ],
      };

      const tokens = TokenCounter.estimateOpenAIInputTokens(request);
      const expectedTokens = '{"city":"Paris"}'.length + '\nget_weather'.length;
      expect(tokens).toBe(expectedTokens);
    });

    it('should count tool definitions', () => {
      const tool = {
        type: 'function',
        function: { name: 'get_weather', parameters: { type: 'object' } },
      };
      const request: ChatCompletionRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [tool],
      };

      const tokens = TokenCounter.estimateOpenAIInputTokens(request);
      const expectedTokens = 'hi'.length + '\n'.length + JSON.stringify(tool).length;
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

      // prompt = 6, response = 8
      expect(result).toEqual({
        inputTokens: 6,
        outputTokens: 8,
        totalTokens: 14,
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

      // hello world = 11 tokens, response = 8 tokens, total = 19
      expect(result).toEqual({
        inputTokens: 11,
        outputTokens: 8,
        totalTokens: 19,
      });
    });

    it('should return undefined if no usage and no accumulated text', () => {
      const result = TokenCounter.buildTokenUsageWithFallback(undefined, {}, 'openai', undefined, 'req-1');
      expect(result).toBeUndefined();
    });
  });
});

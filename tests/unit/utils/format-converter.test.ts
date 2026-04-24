/**
 * Unit tests for format conversion utilities - tool calling support.
 * @see src/utils/format-converter.ts
 */

import { describe, it, expect } from 'vitest';
import {
  convertAnthropicToOpenAIResponse,
  convertOpenAIToAnthropicResponse,
} from '@/utils/format-converter';
import type { AnthropicMessageResponse } from '@/types/anthropic';
import type { ChatCompletionResponse } from '@/types/openai';

describe('format-converter - tool calling', () => {
  describe('convertAnthropicToOpenAIResponse', () => {
    it('should convert tool_use blocks to tool_calls', () => {
      const input: AnthropicMessageResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check the weather.' },
          { type: 'tool_use', id: 'call_abc', name: 'get_weather', input: { location: 'Tokyo' } },
        ],
        model: 'claude-3-opus',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 30 },
      };

      const result = convertAnthropicToOpenAIResponse(input);

      expect(result.choices[0].message.tool_calls).toBeDefined();
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls![0].id).toBe('call_abc');
      expect(result.choices[0].message.tool_calls![0].type).toBe('function');
      expect(result.choices[0].message.tool_calls![0].function.name).toBe('get_weather');
      expect(result.choices[0].message.tool_calls![0].function.arguments).toBe('{"location":"Tokyo"}');
      expect(result.choices[0].message.content).toBe('Let me check the weather.');
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should handle response with only tool_use (no text)', () => {
      const input: AnthropicMessageResponse = {
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_xyz', name: 'search', input: { query: 'test' } },
        ],
        model: 'claude-3-opus',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 20 },
      };

      const result = convertAnthropicToOpenAIResponse(input);

      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should handle multiple tool_use blocks', () => {
      const input: AnthropicMessageResponse = {
        id: 'msg_789',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'func1', input: { a: 1 } },
          { type: 'tool_use', id: 'call_2', name: 'func2', input: { b: 2 } },
        ],
        model: 'claude-3-opus',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 60, output_tokens: 40 },
      };

      const result = convertAnthropicToOpenAIResponse(input);

      expect(result.choices[0].message.tool_calls).toHaveLength(2);
      expect(result.choices[0].message.tool_calls![0].id).toBe('call_1');
      expect(result.choices[0].message.tool_calls![1].id).toBe('call_2');
    });

    it('should map stop_reason tool_use to finish_reason tool_calls', () => {
      const input: AnthropicMessageResponse = {
        id: 'msg_tool',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'test', input: {} }],
        model: 'claude-3',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = convertAnthropicToOpenAIResponse(input);
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should handle response with only text (no tools)', () => {
      const input: AnthropicMessageResponse = {
        id: 'msg_text',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
        model: 'claude-3',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = convertAnthropicToOpenAIResponse(input);

      expect(result.choices[0].message.content).toBe('Hello world');
      expect(result.choices[0].message.tool_calls).toBeUndefined();
      expect(result.choices[0].finish_reason).toBe('stop');
    });
  });

  describe('convertOpenAIToAnthropicResponse', () => {
    it('should convert tool_calls to tool_use blocks', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl_123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
      };

      const result = convertOpenAIToAnthropicResponse(input);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        expect(result.content[0].id).toBe('call_abc');
        expect(result.content[0].name).toBe('get_weather');
        expect(result.content[0].input).toEqual({ location: 'Tokyo' });
      }
      expect(result.stop_reason).toBe('tool_use');
    });

    it('should handle tool_calls with text content', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl_456',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Let me help you.',
            tool_calls: [{
              id: 'call_xyz',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"test"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
      };

      const result = convertOpenAIToAnthropicResponse(input);

      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      expect(result.content[1].type).toBe('tool_use');
    });

    it('should map finish_reason tool_calls to stop_reason tool_use', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl_tool',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 't1',
              type: 'function',
              function: { name: 'test', arguments: '{}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = convertOpenAIToAnthropicResponse(input);
      expect(result.stop_reason).toBe('tool_use');
    });

    it('should handle malformed JSON arguments gracefully', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl_malformed',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_bad',
              type: 'function',
              function: { name: 'test', arguments: 'not valid json' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = convertOpenAIToAnthropicResponse(input);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      if (result.content[0].type === 'tool_use') {
        // Should store raw string as object property when parsing fails
        expect(result.content[0].input).toEqual({ raw: 'not valid json' });
      }
    });

    it('should handle response with only text (no tools)', () => {
      const input: ChatCompletionResponse = {
        id: 'chatcmpl_text',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello world',
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const result = convertOpenAIToAnthropicResponse(input);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.stop_reason).toBe('end_turn');
    });
  });
});
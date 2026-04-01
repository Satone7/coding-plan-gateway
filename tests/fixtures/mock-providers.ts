/**
 * Test fixtures for mock providers.
 * Provides mock responses and server configurations for testing.
 */

import type { ChatCompletionResponse, ChatCompletionChunk, AnthropicMessageResponse } from '@/types';

/**
 * Mock provider configurations.
 */
export const mockProviderConfigs = {
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.5',
  },
  claude: {
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4',
  },
};

/**
 * Create a mock OpenAI chat completion response.
 */
export function createMockChatCompletionResponse(
  overrides: Partial<ChatCompletionResponse> = {}
): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'claude-sonnet-4-6',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
    ...overrides,
  };
}

/**
 * Create mock OpenAI streaming chunks.
 */
export function createMockStreamChunks(content: string = 'Hello world!'): ChatCompletionChunk[] {
  const words = content.split(' ');
  const chunks: ChatCompletionChunk[] = [];

  // Start chunk
  chunks.push({
    id: 'chatcmpl-stream123',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'claude-sonnet-4-6',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  });

  // Content chunks
  for (const word of words) {
    chunks.push({
      id: 'chatcmpl-stream123',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'claude-sonnet-4-6',
      choices: [
        {
          index: 0,
          delta: { content: word + ' ' },
          finish_reason: null,
        },
      ],
    });
  }

  // Final chunk
  chunks.push({
    id: 'chatcmpl-stream123',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'claude-sonnet-4-6',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  });

  return chunks;
}

/**
 * Create a mock Anthropic message response.
 */
export function createMockAnthropicResponse(
  overrides: Partial<AnthropicMessageResponse> = {}
): AnthropicMessageResponse {
  return {
    id: 'msg_test123',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Hello! How can I help you today?',
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
    },
    ...overrides,
  };
}

/**
 * Mock error responses.
 */
export const mockErrorResponses = {
  rateLimited: {
    error: {
      message: 'Rate limit exceeded',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
    },
  },
  invalidApiKey: {
    error: {
      message: 'Invalid API key',
      type: 'authentication_error',
      code: 'invalid_api_key',
    },
  },
  modelNotFound: {
    error: {
      message: 'Model not found',
      type: 'not_found_error',
      code: 'model_not_found',
    },
  },
  serverError: {
    error: {
      message: 'Internal server error',
      type: 'server_error',
      code: 'internal_error',
    },
  },
  quotaExhausted: {
    error: {
      message: 'All coding plans for this model have exhausted quotas',
      type: 'quota_error',
      code: 'QUOTA_EXHAUSTED',
    },
  },
};

/**
 * Create mock OpenAI models list response.
 */
export function createMockModelsResponse(models: string[] = ['model-1', 'model-2']): { object: 'list'; data: Array<{ id: string; object: 'model'; created: number; owned_by: string }> } {
  return {
    object: 'list' as const,
    data: models.map((model) => ({
      id: model,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: 'organization',
    })),
  };
}

/**
 * Mock request delays for testing timeouts.
 */
export const mockDelays = {
  fast: 10,
  normal: 100,
  slow: 1000,
  timeout: 35,
};

/**
 * Helper to create SSE formatted string.
 */
export function formatSSE(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Format OpenAI streaming chunks as SSE string.
 */
export function formatOpenAIStreamAsSSE(chunks: ChatCompletionChunk[]): string {
  return chunks.map((chunk) => formatSSE(chunk)).join('') + 'data: [DONE]\n\n';
}

/**
 * Anthropic streaming event types for testing.
 */
export const mockAnthropicStreamEvents = {
  messageStart: (id: string, model: string) => ({
    type: 'message_start' as const,
    message: {
      id,
      type: 'message' as const,
      role: 'assistant' as const,
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  }),
  contentBlockStart: (index: number) => ({
    type: 'content_block_start' as const,
    index,
    content_block: { type: 'text' as const, text: '' },
  }),
  contentBlockDelta: (index: number, text: string) => ({
    type: 'content_block_delta' as const,
    index,
    delta: { type: 'text_delta' as const, text },
  }),
  contentBlockStop: (index: number) => ({
    type: 'content_block_stop' as const,
    index,
  }),
  messageDelta: (stopReason: string, outputTokens: number) => ({
    type: 'message_delta' as const,
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: { output_tokens: outputTokens },
  }),
  messageStop: () => ({
    type: 'message_stop' as const,
  }),
};
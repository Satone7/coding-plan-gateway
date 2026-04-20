/**
 * Format conversion utilities between OpenAI and Anthropic API formats.
 * Used when a client sends requests in one format but the upstream
 * provider expects the other.
 *
 * @module utils/format-converter
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChunkChoice,
} from '@/types/openai';
import type {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicUsage,
  AnthropicContentBlock,
  AnthropicSystemBlock,
} from '@/types/anthropic';

/**
 * Convert an OpenAI chat completion request to an Anthropic messages request.
 *
 * Key transformations:
 * - system messages → `system` field (string or array of blocks)
 * - `stop` → `stop_sequences`
 * - `max_tokens` defaults to 4096 if not set (required in Anthropic)
 * - OpenAI-only fields (presence_penalty, frequency_penalty, etc.) are dropped
 * - Tool messages are converted to Anthropic tool_use/tool_result content blocks
 */
export function convertOpenAIToAnthropicRequest(req: ChatCompletionRequest): AnthropicMessageRequest {
  const systemParts: { type: 'text'; text: string }[] = [];
  const messages: AnthropicMessageRequest['messages'] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        systemParts.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            systemParts.push({ type: 'text', text: block.text });
          }
        }
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Convert assistant tool_calls to Anthropic tool_use content blocks
      const content: AnthropicContentBlock[] = [];
      if (typeof msg.content === 'string' && msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use' as const,
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        } as unknown as AnthropicContentBlock);
      }
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      // Convert tool result to Anthropic tool_result content block
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result' as const,
          tool_use_id: msg.tool_call_id ?? '',
          content: msg.content ?? '',
        }] as unknown as AnthropicContentBlock[],
      });
      continue;
    }

    // user or assistant (without tool_calls)
    let anthContent: string | AnthropicContentBlock[];
    if (typeof msg.content === 'string' || msg.content == null) {
      anthContent = msg.content ?? '';
    } else if (Array.isArray(msg.content)) {
      const blocks: AnthropicContentBlock[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'image_url' && block.image_url) {
          blocks.push({
            type: 'image',
            source: { type: 'url', media_type: 'image/png', data: block.image_url.url },
          });
        }
      }
      anthContent = blocks;
    } else {
      anthContent = '';
    }
    messages.push({ role: msg.role as 'user' | 'assistant', content: anthContent });
  }

  const result: AnthropicMessageRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? 4096,
    stream: req.stream,
  };

  if (systemParts.length === 1) {
    result.system = systemParts[0]!.text;
  } else if (systemParts.length > 1) {
    result.system = systemParts;
  }

  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stop) {
    result.stop_sequences = typeof req.stop === 'string' ? [req.stop] : req.stop;
  }

  return result;
}

/**
 * Convert an Anthropic messages request to an OpenAI chat completion request.
 */
export function convertAnthropicToOpenAIRequest(req: AnthropicMessageRequest): ChatCompletionRequest {
  const messages: ChatCompletionRequest['messages'] = [];

  if (req.system) {
    if (typeof req.system === 'string') {
      messages.push({ role: 'system', content: req.system });
    } else {
      // Array of system blocks → concatenate text blocks
      const text = req.system
        .filter((b) => b.type === 'text' && typeof (b as { text?: string }).text === 'string')
        .map((b) => (b as { text: string }).text)
        .join('\n');
      if (text) messages.push({ role: 'system', content: text });
    }
  }

  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const textParts: string[] = [];
      for (const block of msg.content) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const blockType = (block as unknown as Record<string, unknown>).type as string;
        if (blockType === 'text') {
          textParts.push((block as unknown as Record<string, string>).text ?? '');
        } else if (blockType === 'tool_use' || blockType === 'tool_result') {
          textParts.push(JSON.stringify(block));
        }
      }
      messages.push({ role: msg.role, content: textParts.join('') || null });
    }
  }

  const result: ChatCompletionRequest = {
    model: req.model,
    messages,
    stream: req.stream,
  };

  if (req.max_tokens) result.max_tokens = req.max_tokens;
  if (req.temperature != null) result.temperature = req.temperature;
  if (req.top_p != null) result.top_p = req.top_p;
  if (req.stop_sequences) result.stop = req.stop_sequences;

  return result;
}

/**
 * Map Anthropic stop_reason to OpenAI finish_reason.
 */
function mapStopReason(reason: string | null): 'stop' | 'length' | null {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return null;
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
function mapFinishReason(reason: string | null): 'end_turn' | 'max_tokens' | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  return null;
}

/**
 * Convert an Anthropic message response to an OpenAI chat completion response.
 */
export function convertAnthropicToOpenAIResponse(resp: AnthropicMessageResponse): ChatCompletionResponse {
  const content = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    id: resp.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: mapStopReason(resp.stop_reason),
    }],
    usage: {
      prompt_tokens: resp.usage.input_tokens,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  };
}

/**
 * Convert an OpenAI chat completion response to an Anthropic message response.
 */
export function convertOpenAIToAnthropicResponse(resp: ChatCompletionResponse): AnthropicMessageResponse {
  const choice = resp.choices[0];
  const content = typeof choice?.message?.content === 'string'
    ? choice.message.content
    : '';

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: resp.model,
    stop_reason: mapFinishReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage.prompt_tokens,
      output_tokens: resp.usage.completion_tokens,
    },
  };
}

/**
 * Stateful converter that translates Anthropic SSE events to OpenAI SSE chunks.
 *
 * Usage:
 * ```
 * const converter = new AnthropicStreamToOpenAIConverter();
 * converter.onChunk = (chunk) => reply.raw.write(chunk);
 * converter.onUsage = (usage) => { ... };
 *
 * // Feed raw SSE lines from upstream
 * for (const line of sseLines) {
 *   converter.feedLine(line);
 * }
 * ```
 */
export class AnthropicStreamToOpenAIConverter {
  private msgId = `chatcmpl-${uuidv4().slice(0, 8)}`;
  private model = '';
  private created = Math.floor(Date.now() / 1000);
  private inputTokens = 0;
  private outputTokens = 0;
  private sentRole = false;

  /** Called with serialized OpenAI SSE chunk lines (with trailing newlines) */
  onChunk: ((data: string) => void) | null = null;
  /** Called once with extracted token usage */
  onUsage: ((usage: { inputTokens: number; outputTokens: number }) => void) | null = null;

  /**
   * Feed a single SSE line (e.g., "data: {...}" or "event: message_start").
   * The converter accumulates event+data pairs and emits converted chunks.
   */
  feedLine(line: string): void {
    const trimmed = line.trim();

    if (trimmed.startsWith('data: ')) {
      const jsonStr = trimmed.slice(6);
      if (!jsonStr) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const data = JSON.parse(jsonStr);
        this.handleData(data);
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  private emit(chunk: ChatCompletionChunk): void {
    if (this.onChunk) {
      this.onChunk(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  }

  private handleData(data: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const type = data.type as string | undefined;
    if (!type) return;

    switch (type) {
      case 'message_start': {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const message = data.message as Record<string, unknown> | undefined;
        if (message) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (typeof message.id === 'string') this.msgId = message.id;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (typeof message.model === 'string') this.model = message.model;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const usage = message.usage as AnthropicUsage | undefined;
          if (usage) this.inputTokens = usage.input_tokens;
        }

        // Emit role chunk
        if (!this.sentRole) {
          this.sentRole = true;
          this.emit({
            id: this.msgId,
            object: 'chat.completion.chunk',
            created: this.created,
            model: this.model,
            choices: [{
              index: 0,
              delta: { role: 'assistant' },
              finish_reason: null,
            }],
          });
        }
        break;
      }

      case 'content_block_delta': {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const delta = data.delta as { type: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          this.emit({
            id: this.msgId,
            object: 'chat.completion.chunk',
            created: this.created,
            model: this.model,
            choices: [{
              index: 0,
              delta: { content: delta.text },
              finish_reason: null,
            }],
          });
        }
        break;
      }

      case 'message_delta': {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const md = data as { delta?: { stop_reason?: string }; usage?: { output_tokens: number } };
        if (md.usage) this.outputTokens = md.usage.output_tokens;

        this.emit({
          id: this.msgId,
          object: 'chat.completion.chunk',
          created: this.created,
          model: this.model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: mapStopReason(md.delta?.stop_reason ?? null),
          }],
        });
        break;
      }

      case 'message_stop': {
        if (this.onUsage) {
          this.onUsage({ inputTokens: this.inputTokens, outputTokens: this.outputTokens });
        }
        if (this.onChunk) {
          this.onChunk('data: [DONE]\n\n');
        }
        break;
      }
    }
  }
}

/**
 * Stateful converter that translates OpenAI SSE chunks to Anthropic SSE events.
 */
export class OpenAIStreamToAnthropicConverter {
  private msgId = `msg_${uuidv4().slice(0, 8)}`;
  private model = '';
  private outputTokens = 0;
  private sentStart = false;
  private sentContentBlockStart = false;

  onChunk: ((data: string) => void) | null = null;
  onUsage: ((usage: { inputTokens: number; outputTokens: number }) => void) | null = null;

  feedLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) return;

    const jsonStr = trimmed.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') {
      if (jsonStr === '[DONE]' && this.sentStart) {
        // Emit message_stop
        if (this.onChunk) {
          this.onChunk(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        }
        if (this.onUsage) {
          this.onUsage({ inputTokens: 0, outputTokens: this.outputTokens });
        }
      }
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const data = JSON.parse(jsonStr) as ChatCompletionChunk;
      this.handleChunk(data);
    } catch {
      // Ignore malformed JSON
    }
  }

  private handleChunk(chunk: ChatCompletionChunk): void {
    if (!this.sentStart) {
      this.sentStart = true;
      this.model = chunk.model;
      if (this.onChunk) {
        this.onChunk(`event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: this.msgId,
            type: 'message',
            role: 'assistant',
            model: chunk.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}\n\n`);

        this.onChunk(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`);

        this.sentContentBlockStart = true;
      }
    }

    const choice: ChatCompletionChunkChoice | undefined = chunk.choices?.[0];
    if (!choice) return;

    // Emit content delta
    if (choice.delta?.content) {
      if (this.onChunk) {
        this.onChunk(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: choice.delta.content },
        })}\n\n`);
      }
      // Rough token estimation (1 token ≈ 4 chars)
      this.outputTokens += Math.ceil(choice.delta.content.length / 4);
    }

    // Emit finish
    if (choice.finish_reason) {
      if (this.sentContentBlockStart && this.onChunk) {
        this.onChunk(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n\n`);
        this.sentContentBlockStart = false;
      }

      if (this.onChunk) {
        this.onChunk(`event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: {
            stop_reason: mapFinishReason(choice.finish_reason) ?? 'end_turn',
            stop_sequence: null,
          },
          usage: { output_tokens: this.outputTokens },
        })}\n\n`);
      }
    }
  }
}

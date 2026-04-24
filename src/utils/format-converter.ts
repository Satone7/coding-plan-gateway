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
  ChatMessage,
} from '@/types/openai';
import type {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicUsage,
  AnthropicContentBlock,
  AnthropicSystemBlock,
  AnthropicToolUseBlock,
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
function mapStopReason(reason: string | null): 'stop' | 'length' | 'tool_calls' | null {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  return null;
}

/**
 * Map OpenAI finish_reason to Anthropic stop_reason.
 */
function mapFinishReason(reason: string | null): 'end_turn' | 'max_tokens' | 'tool_use' | null {
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'tool_calls') return 'tool_use';
  return null;
}

/**
 * Convert an Anthropic message response to an OpenAI chat completion response.
 */
export function convertAnthropicToOpenAIResponse(resp: AnthropicMessageResponse): ChatCompletionResponse {
  // Separate text and tool_use content
  const textContent = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Extract tool_calls from tool_use blocks
  const toolCalls = resp.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => {
      const block = b as AnthropicToolUseBlock;
      return {
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      };
    });

  // Build message with optional tool_calls
  const message: ChatMessage = {
    role: 'assistant',
    content: textContent || null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: resp.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [{
      index: 0,
      message,
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
  const message = choice?.message;

  // Build content blocks array
  const content: AnthropicContentBlock[] = [];

  // Add text block if content exists
  if (typeof message?.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Convert tool_calls to tool_use blocks
  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        // If parsing fails, store raw string as object
        input = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      } as AnthropicToolUseBlock);
    }
  }

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    content,
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
  private toolBlockStates: Map<number, { id: string; name: string }> = new Map();
  private toolCallIndex = 0;

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

    // Handle both "data: {...}" (with space) and "data:{...}" (without space)
    if (trimmed.startsWith('data:') && trimmed.length > 5) {
      // Strip "data:" or "data: " prefix
      const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5);
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

      case 'content_block_start': {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const contentBlock = data.content_block as { type?: string; id?: string; name?: string } | undefined;
        if (contentBlock?.type === 'tool_use' && contentBlock.id && contentBlock.name) {
          const index = data.index as number;
          this.toolBlockStates.set(index, {
            id: contentBlock.id,
            name: contentBlock.name,
          });
          this.emit({
            id: this.msgId,
            object: 'chat.completion.chunk',
            created: this.created,
            model: this.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: this.toolCallIndex,
                  id: contentBlock.id,
                  type: 'function',
                  function: { name: contentBlock.name },
                }],
              },
              finish_reason: null,
            }],
          });
          this.toolCallIndex++;
        }
        break;
      }

      case 'content_block_delta': {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const index = data.index as number;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const delta = data.delta as { type: string; text?: string; partial_json?: string } | undefined;
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
        } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
          this.emit({
            id: this.msgId,
            object: 'chat.completion.chunk',
            created: this.created,
            model: this.model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: index,
                  function: { arguments: delta.partial_json },
                }],
              },
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
  private currentNonToolBlockType: 'text' | null = null;
  private currentNonToolBlockIndex: number | null = null;
  private toolBlockStates: Map<number, {
    anthropicIndex: number;
    id: string;
    name: string;
    started: boolean;
    pendingArgs: string;
  }> = new Map();
  private nextContentBlockIndex = 0;

  onChunk: ((data: string) => void) | null = null;
  onUsage: ((usage: { inputTokens: number; outputTokens: number }) => void) | null = null;

  feedLine(line: string): void {
    const trimmed = line.trim();
    // Handle both "data: {...}" (with space) and "data:{...}" (without space)
    if (!trimmed.startsWith('data:')) return;

    // Strip "data:" or "data: " prefix
    const jsonStr = (trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)).trim();
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
    const choice: ChatCompletionChunkChoice | undefined = chunk.choices?.[0];
    if (!choice) return;

    // Initialize message_start on first chunk
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
      }
    }

    // Handle tool_calls delta
    if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
      // Close any open non-tool content block first
      if (this.currentNonToolBlockType === 'text' && this.currentNonToolBlockIndex !== null && this.onChunk) {
        this.onChunk(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: this.currentNonToolBlockIndex,
        })}\n\n`);
        this.currentNonToolBlockType = null;
        this.currentNonToolBlockIndex = null;
      }

      for (const tc of choice.delta.tool_calls) {
        const openaiIndex = tc.index;

        // Get or create tool block state
        let state = this.toolBlockStates.get(openaiIndex);
        if (!state) {
          state = {
            anthropicIndex: this.nextContentBlockIndex,
            id: '',
            name: '',
            started: false,
            pendingArgs: '',
          };
          this.toolBlockStates.set(openaiIndex, state);
          this.nextContentBlockIndex++;
        }

        // Update id and name if provided
        if (tc.id) state.id = tc.id;
        if (tc.function?.name) state.name = tc.function.name;

        // Handle arguments delta
        const argsDelta = tc.function?.arguments;
        if (argsDelta) {
          if (!state.started) {
            // Accumulate until we have id and name
            state.pendingArgs += argsDelta;
          } else {
            // Stream arguments directly
            if (this.onChunk) {
              this.onChunk(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: state.anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: argsDelta,
                },
              })}\n\n`);
            }
          }
        }

        // Start content block when we have id and name
        if (!state.started && state.id && state.name) {
          state.started = true;
          if (this.onChunk) {
            this.onChunk(`event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: state.anthropicIndex,
              content_block: {
                type: 'tool_use',
                id: state.id,
                name: state.name,
              },
            })}\n\n`);
          }

          // Emit any pending args
          if (state.pendingArgs) {
            if (this.onChunk) {
              this.onChunk(`event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: state.anthropicIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: state.pendingArgs,
                },
              })}\n\n`);
            }
            state.pendingArgs = '';
          }
        }
      }
    }

    // Handle text content delta
    if (choice.delta?.content) {
      // Start text content block if needed
      if (this.currentNonToolBlockType === null) {
        this.currentNonToolBlockType = 'text';
        this.currentNonToolBlockIndex = this.nextContentBlockIndex;
        this.nextContentBlockIndex++;
        if (this.onChunk) {
          this.onChunk(`event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: this.currentNonToolBlockIndex,
            content_block: { type: 'text', text: '' },
          })}\n\n`);
        }
      }

      // Emit text delta
      if (this.onChunk) {
        this.onChunk(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: this.currentNonToolBlockIndex,
          delta: { type: 'text_delta', text: choice.delta.content },
        })}\n\n`);
      }
      // Rough token estimation (1 token ≈ 4 chars)
      this.outputTokens += Math.ceil(choice.delta.content.length / 4);
    }

    // Emit finish
    if (choice.finish_reason) {
      // Close any open non-tool content block
      if (this.currentNonToolBlockType === 'text' && this.currentNonToolBlockIndex !== null && this.onChunk) {
        this.onChunk(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: this.currentNonToolBlockIndex,
        })}\n\n`);
        this.currentNonToolBlockType = null;
        this.currentNonToolBlockIndex = null;
      }

      // Close all tool blocks
      for (const [, state] of this.toolBlockStates) {
        if (state.started && this.onChunk) {
          this.onChunk(`event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: state.anthropicIndex,
          })}\n\n`);
        }
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

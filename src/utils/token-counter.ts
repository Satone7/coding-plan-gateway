import { countTokens } from '@anthropic-ai/tokenizer';
import { logger } from '@/utils/logger';
import { AnthropicCountTokensRequest, AnthropicMessageRequest } from '@/types/anthropic';
import { ChatCompletionRequest } from '@/types/openai';

export class TokenCounter {
  /**
   * Build a fallback token usage object when upstream doesn't provide one.
   * Calculates input/output tokens based on the request and accumulated response text.
   * Always returns a normalized object if totalTokens can be determined, otherwise undefined.
   */
  static buildTokenUsageWithFallback(
    tokenUsage: { totalTokens?: number; inputTokens?: number; outputTokens?: number } | undefined,
    request: unknown,
    provider: 'anthropic' | 'openai',
    accumulatedText?: string,
    requestId?: string
  ): { totalTokens: number; inputTokens: number; outputTokens: number } | undefined {
    let finalTokenUsage = tokenUsage;

    // totalTokens may be 0 (false positive from extractStreamTokenUsage matching a zero
    // in the stream tail), or undefined (no match at all). In either case, if accumulatedText
    // is non-empty, estimate locally from the request body + accumulated output.
    const tokenCountMissing = finalTokenUsage?.totalTokens === undefined || finalTokenUsage?.totalTokens === 0;
    if (tokenCountMissing && accumulatedText) {
      const inputTokens = provider === 'anthropic'
        ? this.estimateAnthropicInputTokens(request as AnthropicCountTokensRequest | AnthropicMessageRequest)
        : this.estimateOpenAIInputTokens(request as ChatCompletionRequest);

      const outputTokens = this.estimateOutputTokens(accumulatedText);

      finalTokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      logger.debug(`Using local token estimation fallback for ${provider} response`, {
        requestId,
        inputTokens,
        outputTokens,
      });
    }

    if (finalTokenUsage?.totalTokens !== undefined) {
      return {
        totalTokens: finalTokenUsage.totalTokens,
        inputTokens: finalTokenUsage.inputTokens ?? 0,
        outputTokens: finalTokenUsage.outputTokens ?? 0,
      };
    }

    return undefined;
  }

  /**
   * Collect countable text from a value of unknown shape.
   *
   * Upstream providers tokenize the full request structure (tool_use inputs, tool_result
   * payloads, tool schemas), not just text blocks. Skipping non-text content undercounts
   * agentic traffic massively (tool_result bodies dominate Claude Code sessions). We mirror
   * the provider behavior by tokenizing the JSON representation of structured values, while
   * extracting plain text recursively so strings are not charged JSON syntax overhead.
   */
  private static collectText(value: unknown, parts: string[]): void {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      parts.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        this.collectText(item, parts);
      }
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      // Content-block-like objects: count their payload text without JSON syntax noise.
      if (record.type === 'text' && typeof record.text === 'string') {
        parts.push(record.text);
        return;
      }
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) {
          parts.push(json);
        }
      } catch {
        // Unserializable value (circular reference, BigInt) — skip rather than fail the request.
      }
    }
    // Numbers/booleans contribute a negligible token or two; ignore.
  }

  /**
   * Rough token estimate for a base64-encoded document payload.
   */
  private static estimateDocumentTokens(source: unknown): number {
    if (source && typeof source === 'object') {
      const data = (source as { data?: unknown }).data;
      if (typeof data === 'string') {
        return Math.ceil(data.length / 4);
      }
    }
    return 0;
  }

  /**
   * Count one Anthropic content block (message or system) into the accumulators.
   */
  // eslint-disable-next-line max-depth
  private static collectAnthropicBlock(
    block: { type: string; text?: string },
    parts: string[],
    state: { additionalTokens: number }
  ): void {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image') {
      state.additionalTokens += 1000;
    } else if (block.type === 'tool_use') {
      // Assistant tool calls: the model sees id/name/input serialized as JSON.
      const toolUse = block as { input?: unknown; name?: string };
      this.collectText(toolUse.input, parts);
      if (typeof toolUse.name === 'string') {
        parts.push(toolUse.name);
      }
    } else if (block.type === 'tool_result') {
      // Tool results carry the bulk of agentic traffic (file contents, command output).
      this.collectText((block as { content?: unknown }).content, parts);
    } else if (block.type === 'document') {
      // AnthropicContentBlock has no document variant, but providers accept it in
      // message content (and inside tool_result content); count it if present.
      state.additionalTokens += this.estimateDocumentTokens((block as { source?: unknown }).source);
    } else {
      this.collectText(block, parts);
    }
  }

  /**
   * Estimate token count for Anthropic requests as a fallback.
   * Uses @anthropic-ai/tokenizer to calculate token usage for text.
   * Images are roughly estimated at 1000 tokens per image.
   * Documents are roughly estimated at 1 token per 4 characters of base64 data.
   * tool_use / tool_result blocks and tool schemas are counted via their JSON form.
   */
  static estimateAnthropicInputTokens(request: AnthropicCountTokensRequest | AnthropicMessageRequest): number {
    const parts: string[] = [];
    const state = { additionalTokens: 0 };

    if (request.system) {
      if (typeof request.system === 'string') {
        parts.push(request.system);
      } else if (Array.isArray(request.system)) {
        for (const block of request.system) {
          this.collectAnthropicBlock(block as { type: string; text?: string }, parts, state);
        }
      }
    }

    if (request.messages && Array.isArray(request.messages)) {
      for (const msg of request.messages) {
        if (typeof msg.content === 'string') {
          parts.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            this.collectAnthropicBlock(block as { type: string; text?: string }, parts, state);
          }
        }
      }
    }

    // Tool definitions are part of the serialized prompt on every request.
    const tools = (request as { tools?: unknown }).tools;
    if (tools !== undefined) {
      this.collectText(tools, parts);
    }

    const text = parts.join('\n');
    try {
      return countTokens(text) + state.additionalTokens;
    } catch (error) {
      logger.warn('Failed to calculate tokens with tokenizer, falling back to basic estimation', { error });
      return Math.ceil(text.length / 4) + state.additionalTokens;
    }
  }

  /**
   * Count one OpenAI chat message into the accumulators.
   */
  // eslint-disable-next-line max-depth
  private static collectOpenAIMessage(
    msg: { content?: unknown; tool_calls?: unknown },
    parts: string[],
    state: { additionalTokens: number }
  ): void {
    if (typeof msg.content === 'string') {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const typedBlock = block as { type?: string; text?: string };
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          parts.push(typedBlock.text);
        } else if (typedBlock.type === 'image_url') {
          state.additionalTokens += 1000;
        } else {
          this.collectText(block, parts);
        }
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        // arguments is a JSON string already; count it plus the function name.
        const fn = (call as { function?: { name?: string; arguments?: string } }).function;
        parts.push(fn?.arguments ?? '');
        if (fn?.name) {
          parts.push(fn.name);
        }
      }
    }
  }

  /**
   * Estimate token count for OpenAI requests as a fallback.
   * Uses @anthropic-ai/tokenizer to calculate token usage for text.
   * tool_calls arguments and tool schemas are counted via their JSON form.
   */
  static estimateOpenAIInputTokens(request: ChatCompletionRequest): number {
    const parts: string[] = [];
    const state = { additionalTokens: 0 };

    if (request.messages && Array.isArray(request.messages)) {
      for (const msg of request.messages) {
        this.collectOpenAIMessage(msg, parts, state);
      }
    }

    const tools = (request as { tools?: unknown }).tools;
    if (tools !== undefined) {
      this.collectText(tools, parts);
    }

    const text = parts.join('\n');
    try {
      return countTokens(text) + state.additionalTokens;
    } catch (error) {
      logger.warn('Failed to calculate tokens with tokenizer, falling back to basic estimation', { error });
      return Math.ceil(text.length / 4) + state.additionalTokens;
    }
  }

  /**
   * Estimate output tokens for a generated text string.
   */
  static estimateOutputTokens(text: string): number {
    if (!text) {
      return 0;
    }
    try {
      return countTokens(text);
    } catch (error) {
      logger.warn('Failed to calculate output tokens with tokenizer, falling back to basic estimation', { error });
      return Math.ceil(text.length / 4);
    }
  }
}

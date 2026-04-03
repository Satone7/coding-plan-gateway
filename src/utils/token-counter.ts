/* eslint-disable max-depth, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
import { countTokens } from '@anthropic-ai/tokenizer';
import { logger } from '@/utils/logger';
import { AnthropicCountTokensRequest, AnthropicMessageRequest } from '@/types/anthropic';
import { ChatCompletionRequest } from '@/types/openai';

export class TokenCounter {
  /**
   * Estimate token count for Anthropic requests as a fallback.
   * Uses @anthropic-ai/tokenizer to calculate token usage for text.
   * Images are roughly estimated at 1000 tokens per image.
   * Documents are roughly estimated at 1 token per 4 characters of base64 data.
   */
  static estimateAnthropicInputTokens(request: AnthropicCountTokensRequest | AnthropicMessageRequest): number {
    let text = '';
    let additionalTokens = 0;
    
    if (request.system) {
      if (typeof request.system === 'string') {
        text += request.system + '\n';
      } else if (Array.isArray(request.system)) {
        for (const block of request.system) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text + '\n';
          } else if (block.type === 'image') {
            additionalTokens += 1000;
          } else if (block.type === 'document') {
            const docBlock = block as any;
            if (typeof docBlock.source?.data === 'string') {
              additionalTokens += Math.ceil(docBlock.source.data.length / 4);
            }
          }
        }
      }
    }
    if (request.messages && Array.isArray(request.messages)) {
      for (const msg of request.messages) {
        if (typeof msg.content === 'string') {
          text += msg.content + '\n';
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              text += block.text + '\n';
            } else if (block.type === 'image') {
              additionalTokens += 1000;
            } else if ((block as any).type === 'document') {
              const docBlock = block as any;
              if (typeof docBlock.source?.data === 'string') {
                additionalTokens += Math.ceil(docBlock.source.data.length / 4);
              }
            }
          }
        }
      }
    }
    
    try {
      return countTokens(text) + additionalTokens;
    } catch (error) {
      logger.warn('Failed to calculate tokens with tokenizer, falling back to basic estimation', { error });
      return Math.ceil(text.length / 4) + additionalTokens;
    }
  }

  /**
   * Estimate token count for OpenAI requests as a fallback.
   * Uses @anthropic-ai/tokenizer to calculate token usage for text.
   */
  static estimateOpenAIInputTokens(request: ChatCompletionRequest): number {
    let text = '';
    let additionalTokens = 0;
    
    if (request.messages && Array.isArray(request.messages)) {
      for (const msg of request.messages) {
        if (typeof msg.content === 'string') {
          text += msg.content + '\n';
        } else if (Array.isArray(msg.content)) {
          // OpenAI vision/multimodal messages
          for (const block of msg.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              text += block.text + '\n';
            } else if (block.type === 'image_url') {
              additionalTokens += 1000;
            }
          }
        }
      }
    }

    try {
      return countTokens(text) + additionalTokens;
    } catch (error) {
      logger.warn('Failed to calculate tokens with tokenizer, falling back to basic estimation', { error });
      return Math.ceil(text.length / 4) + additionalTokens;
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

/**
 * RequestProxy service for forwarding requests to upstream providers.
 * Handles both OpenAI and Anthropic format requests with streaming support.
 */

import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@/types/openai';
import type {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicStreamEvent,
} from '@/types/anthropic';
import { logger } from '@/utils/logger';
import { DEFAULT_USER_AGENT } from '@/config/defaults';

/**
 * Proxy request options.
 */
export interface ProxyRequestOptions {
  /** Upstream provider base URL */
  baseUrl: string;
  /** Decrypted API key for upstream */
  apiKey: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Request ID for tracing */
  requestId?: string;
}

/**
 * Upstream response with metadata.
 */
export interface UpstreamResponse<T> {
  /** Response data */
  data: T;
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response duration in milliseconds */
  durationMs: number;
}

/**
 * Streaming callback for SSE events.
 */
export type StreamCallback = (chunk: string, done: boolean) => void;

/**
 * RequestProxy class for forwarding requests to upstream providers.
 */
export class RequestProxy {
  /**
   * Forward an OpenAI-format request to the upstream provider.
   */
  async forwardOpenAIRequest(
    request: ChatCompletionRequest,
    options: ProxyRequestOptions
  ): Promise<UpstreamResponse<ChatCompletionResponse>> {
    const url = new URL('/v1/chat/completions', options.baseUrl);
    const startTime = Date.now();

    logger.debug('Forwarding OpenAI request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
      stream: request.stream,
    });

    const response = await this.makeRequest<ChatCompletionResponse>(
      url,
      'POST',
      options.apiKey,
      request,
      options.timeout ?? 30000
    );

    response.durationMs = Date.now() - startTime;

    logger.info('OpenAI request completed', {
      requestId: options.requestId,
      statusCode: response.statusCode,
      durationMs: response.durationMs,
    });

    return response;
  }

  /**
   * Forward an OpenAI-format streaming request.
   */
  async forwardOpenAIStream(
    request: ChatCompletionRequest,
    options: ProxyRequestOptions,
    onChunk: StreamCallback,
    reply: FastifyReply
  ): Promise<void> {
    const url = new URL('/v1/chat/completions', options.baseUrl);
    const startTime = Date.now();

    logger.debug('Forwarding OpenAI streaming request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    await this.makeStreamingRequest(
      url,
      'POST',
      options.apiKey,
      request,
      options.timeout ?? 60000,
      (chunk) => {
        // Forward the chunk as-is
        onChunk(chunk, false);
        reply.raw.write(`data: ${chunk}\n\n`);
      },
      () => {
        onChunk('', true);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        logger.info('OpenAI streaming request completed', {
          requestId: options.requestId,
          durationMs,
        });
      }
    );
  }

  /**
   * Forward an Anthropic-format request to the upstream provider.
   */
  async forwardAnthropicRequest(
    request: AnthropicMessageRequest,
    options: ProxyRequestOptions
  ): Promise<UpstreamResponse<AnthropicMessageResponse>> {
    const url = new URL('/v1/messages', options.baseUrl);
    const startTime = Date.now();

    logger.debug('Forwarding Anthropic request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
      stream: request.stream,
    });

    const response = await this.makeRequest<AnthropicMessageResponse>(
      url,
      'POST',
      options.apiKey,
      request,
      options.timeout ?? 30000,
      {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    );

    response.durationMs = Date.now() - startTime;

    logger.info('Anthropic request completed', {
      requestId: options.requestId,
      statusCode: response.statusCode,
      durationMs: response.durationMs,
    });

    return response;
  }

  /**
   * Forward an Anthropic-format streaming request.
   */
  async forwardAnthropicStream(
    request: AnthropicMessageRequest,
    options: ProxyRequestOptions,
    onChunk: StreamCallback,
    reply: FastifyReply
  ): Promise<void> {
    const url = new URL('/v1/messages', options.baseUrl);
    const startTime = Date.now();

    logger.debug('Forwarding Anthropic streaming request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    await this.makeStreamingRequest(
      url,
      'POST',
      options.apiKey,
      request,
      options.timeout ?? 60000,
      (chunk) => {
        onChunk(chunk, false);
        reply.raw.write(`data: ${chunk}\n\n`);
      },
      () => {
        onChunk('', true);
        reply.raw.end();

        const durationMs = Date.now() - startTime;
        logger.info('Anthropic streaming request completed', {
          requestId: options.requestId,
          durationMs,
        });
      },
      {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    );
  }

  /**
   * Make an HTTP request and return the parsed response.
   */
  private makeRequest<T>(
    url: URL,
    method: string,
    apiKey: string,
    body: unknown,
    timeout: number,
    extraHeaders?: Record<string, string>
  ): Promise<UpstreamResponse<T>> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': DEFAULT_USER_AGENT,
        ...extraHeaders,
      };

      const req = requestFn(
        url,
        {
          method,
          headers,
          timeout,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            const responseHeaders: Record<string, string> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined) {
                responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
              }
            }

            if (res.statusCode && res.statusCode >= 400) {
              const error = new Error(
                `Upstream error: ${res.statusCode} - ${data.slice(0, 500)}`
              );
              (error as Error & { statusCode?: number }).statusCode = res.statusCode;
              reject(error);
              return;
            }

            try {
              const parsed = JSON.parse(data) as T;
              resolve({
                data: parsed,
                statusCode: res.statusCode ?? 200,
                headers: responseHeaders,
                durationMs: 0,
              });
            } catch (parseError) {
              reject(new Error(`Failed to parse upstream response: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Make a streaming HTTP request.
   */
  private makeStreamingRequest(
    url: URL,
    method: string,
    apiKey: string,
    body: unknown,
    timeout: number,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    extraHeaders?: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
        'User-Agent': DEFAULT_USER_AGENT,
        ...extraHeaders,
      };

      const req = requestFn(
        url,
        {
          method,
          headers,
          timeout,
        },
        (res) => {
          let buffer = '';

          res.on('data', (chunk) => {
            const text = chunk.toString();
            buffer += text;

            // Process SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data !== '[DONE]') {
                  onChunk(data);
                }
              }
            }
          });

          res.on('end', () => {
            // Process any remaining buffer
            if (buffer.startsWith('data: ')) {
              const data = buffer.slice(6);
              if (data !== '[DONE]') {
                onChunk(data);
              }
            }
            onComplete();
            resolve();
          });

          res.on('error', (error) => {
            reject(new Error(`Stream error: ${error.message}`));
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }
}

/**
 * Create a new RequestProxy instance.
 */
export function createRequestProxy(): RequestProxy {
  return new RequestProxy();
}

/**
 * Default proxy instance.
 */
export const requestProxy = new RequestProxy();
/* eslint-disable max-depth, max-lines-per-function */
/**
 * RequestProxy service for forwarding requests to upstream providers.
 * Handles both OpenAI and Anthropic format requests with streaming support.
 */

import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import type { FastifyReply } from 'fastify';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '@/types/openai';
import type {
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicCountTokensRequest,
  AnthropicCountTokensResponse,
} from '@/types/anthropic';
import { logger } from '@/utils/logger';
import { DEFAULT_USER_AGENT, DEFAULT_REQUEST_TIMEOUT_SEC } from '@/config/defaults';

/**
 * Proxy request options.
 */
export interface ProxyRequestOptions {
  /** Upstream provider base URL */
  baseUrl: string;
  /** Decrypted API key for upstream */
  apiKey: string;
  /** Request timeout in seconds */
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
 * Options for internal HTTP requests.
 */
interface InternalRequestOptions {
  url: URL;
  method: string;
  apiKey: string;
  body: unknown;
  timeout: number;
  extraHeaders?: Record<string, string>;
  authType?: 'bearer' | 'x-api-key' | 'both';
}

/**
 * Options for internal streaming requests.
 */
interface InternalStreamingOptions extends InternalRequestOptions {
  reply: FastifyReply;
  onComplete: (tokenUsage?: StreamTokenUsage, accumulatedText?: string) => void;
}

/**
 * Token usage extracted from streaming SSE events.
 */
export interface StreamTokenUsage {
  totalTokens?: number;
}

/**
 * Extract token usage from the tail of an SSE stream.
 * Handles both OpenAI and Anthropic streaming formats.
 */
function extractStreamTokenUsage(tail: string): StreamTokenUsage | undefined {
  // OpenAI format: "usage":{"prompt_tokens":X,"completion_tokens":Y,"total_tokens":Z}
  const openaiMatch = tail.match(/"total_tokens"\s*:\s*(\d+)/);
  if (openaiMatch) {
    return { totalTokens: parseInt(openaiMatch[1]!, 10) };
  }

  // Anthropic format: look for input_tokens and output_tokens in separate events
  const inputMatch = tail.match(/"input_tokens"\s*:\s*(\d+)/);
  const outputMatch = tail.match(/"output_tokens"\s*:\s*(\d+)/);
  if (inputMatch || outputMatch) {
    const input = inputMatch ? parseInt(inputMatch[1]!, 10) : 0;
    const output = outputMatch ? parseInt(outputMatch[1]!, 10) : 0;
    return { totalTokens: input + output };
  }

  return undefined;
}

/**
 * Build request headers.
 */
function buildHeaders(
  apiKey: string,
  authType: 'bearer' | 'x-api-key' | 'both' = 'bearer',
  extraHeaders?: Record<string, string>,
  isStreaming?: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': DEFAULT_USER_AGENT,
  };

  // Add authentication headers based on explicitly requested type
  if (authType === 'bearer' || authType === 'both') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (authType === 'x-api-key' || authType === 'both') {
    headers['x-api-key'] = apiKey;
  }

  if (isStreaming) {
    headers.Accept = 'text/event-stream';
  }

  return { ...headers, ...extraHeaders };
}

/**
 * Handle HTTP response and collect data.
 */
function handleResponse<T>(
  res: import('http').IncomingMessage,
  resolve: (value: UpstreamResponse<T>) => void,
  reject: (reason: Error) => void
): void {
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
    } catch {
      reject(new Error(`Failed to parse upstream response: ${data.slice(0, 200)}`));
    }
  });
}

/**
 * Setup request error handlers.
 */
function setupErrorHandlers(
  req: import('http').ClientRequest,
  reject: (reason: Error) => void
): void {
  req.on('error', (error) => {
    reject(new Error(`Request failed: ${error.message}`));
  });

  req.on('timeout', () => {
    req.destroy();
    reject(new Error('Request timeout'));
  });
}

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
    const basePath = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    const url = new URL(`${basePath}/v1/chat/completions`);
    const startTime = Date.now();

    logger.debug('Forwarding OpenAI request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
      stream: request.stream,
    });

    const response = await this.makeRequest<ChatCompletionResponse>({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'bearer',
    });

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
    reply: FastifyReply,
    onTokenUsage?: (tokenUsage?: StreamTokenUsage, accumulatedText?: string) => void
  ): Promise<void> {
    const basePath = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    const url = new URL(`${basePath}/v1/chat/completions`);
    const startTime = Date.now();

    logger.debug('Forwarding OpenAI streaming request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    // Set SSE headers for transparent streaming
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    await this.makeStreamingRequest({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'bearer',
      reply,
      onComplete: (tokenUsage, accumulatedText) => {
        onChunk('', true);
        if (onTokenUsage) {
          onTokenUsage(tokenUsage, accumulatedText);
        }
        const durationMs = Date.now() - startTime;
        logger.info('OpenAI streaming request completed', {
          requestId: options.requestId,
          durationMs,
          totalTokens: tokenUsage?.totalTokens,
        });
      },
    });
  }

  /**
   * Forward an Anthropic-format request to the upstream provider.
   */
  async forwardAnthropicRequest(
    request: AnthropicMessageRequest,
    options: ProxyRequestOptions
  ): Promise<UpstreamResponse<AnthropicMessageResponse>> {
    const basePath = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    
    // Support both baseUrl with and without /v1
    const urlPath = basePath.endsWith('/v1') ? '/messages' : '/v1/messages';
    const url = new URL(`${basePath}${urlPath}`);
    const startTime = Date.now();

    logger.debug('Forwarding Anthropic request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
      stream: request.stream,
    });

    const response = await this.makeRequest<AnthropicMessageResponse>({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'x-api-key',
      extraHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });

    response.durationMs = Date.now() - startTime;

    logger.info('Anthropic request completed', {
      requestId: options.requestId,
      statusCode: response.statusCode,
      durationMs: response.durationMs,
    });

    return response;
  }

  /**
   * Forward an Anthropic-format count tokens request to the upstream provider.
   */
  async forwardAnthropicCountTokensRequest(
    request: AnthropicCountTokensRequest,
    options: ProxyRequestOptions
  ): Promise<UpstreamResponse<AnthropicCountTokensResponse>> {
    const basePath = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    
    // Support both baseUrl with and without /v1
    const urlPath = basePath.endsWith('/v1') ? '/messages/count_tokens' : '/v1/messages/count_tokens';
    const url = new URL(`${basePath}${urlPath}`);
    const startTime = Date.now();

    logger.debug('Forwarding Anthropic count tokens request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    const response = await this.makeRequest<AnthropicCountTokensResponse>({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'x-api-key',
      extraHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });

    response.durationMs = Date.now() - startTime;

    logger.info('Anthropic count tokens request completed', {
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
    reply: FastifyReply,
    onTokenUsage?: (tokenUsage?: StreamTokenUsage, accumulatedText?: string) => void
  ): Promise<void> {
    const basePath = options.baseUrl.endsWith('/')
      ? options.baseUrl.slice(0, -1)
      : options.baseUrl;
    
    // Support both baseUrl with and without /v1
    const urlPath = basePath.endsWith('/v1') ? '/messages' : '/v1/messages';
    const url = new URL(`${basePath}${urlPath}`);
    const startTime = Date.now();

    logger.debug('Forwarding Anthropic streaming request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    // Set SSE headers for transparent streaming
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    await this.makeStreamingRequest({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'x-api-key',
      extraHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      reply,
      onComplete: (tokenUsage, accumulatedText) => {
        onChunk('', true);
        if (onTokenUsage) {
          onTokenUsage(tokenUsage, accumulatedText);
        }
        const durationMs = Date.now() - startTime;
        logger.info('Anthropic streaming request completed', {
          requestId: options.requestId,
          durationMs,
          totalTokens: tokenUsage?.totalTokens,
        });
      },
    });
  }

  /**
   * Make an HTTP request and return the parsed response.
   */
  private makeRequest<T>(options: InternalRequestOptions): Promise<UpstreamResponse<T>> {
    return new Promise((resolve, reject) => {
      const isHttps = options.url.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;
      const headers = buildHeaders(options.apiKey, options.authType || 'bearer', options.extraHeaders);
      const bodyStr = JSON.stringify(options.body);
      headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

      const req = requestFn(
        options.url,
        { method: options.method, headers, timeout: options.timeout * 1000 },
        (res) => handleResponse<T>(res, resolve, reject)
      );

      setupErrorHandlers(req, reject);
      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * Make a streaming HTTP request.
   * When SSE headers are already sent, errors are delivered as SSE events
   * to avoid ERR_HTTP_HEADERS_SENT crashes.
   */
  private makeStreamingRequest(options: InternalStreamingOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const isHttps = options.url.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;
      const headers = buildHeaders(options.apiKey, options.authType || 'bearer', options.extraHeaders, true);
      const bodyStr = JSON.stringify(options.body);
      headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

      /**
       * Handle errors after SSE headers have been sent.
       * Sends an error event to the client and ends the response.
       */
      const handleStreamError = (errorMessage: string): void => {
        if (options.reply.raw.headersSent) {
          try {
            options.reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`);
          } catch {
            // Ignore write errors on closed connections
          }
          options.reply.raw.end();
        }
        reject(new Error(errorMessage));
      };

      const req = requestFn(
        options.url,
        { method: options.method, headers, timeout: options.timeout * 1000 },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              handleStreamError(`Upstream error: ${res.statusCode} - ${data.slice(0, 500)}`);
            });
            return;
          }

          // Forward chunks manually instead of piping, to extract token usage from tail
          let tailData = '';
          let sseBuffer = '';
          let accumulatedText = '';
          
          res.on('data', (chunk: Buffer) => {
            options.reply.raw.write(chunk);
            const chunkStr = chunk.toString();
            tailData += chunkStr;
            // Keep last 4KB for usage extraction
            if (tailData.length > 4096) {
              tailData = tailData.slice(-4096);
            }
            
            // Extract text from SSE data
            sseBuffer += chunkStr;
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  const data = JSON.parse(line.slice(6));
                  // OpenAI format
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  if (data.choices?.[0]?.delta?.content) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    accumulatedText += data.choices[0].delta.content;
                  }
                  // Anthropic format
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  if (data.type === 'content_block_delta' && data.delta?.text) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    accumulatedText += data.delta.text;
                  }
                } catch {
                  // ignore partial or invalid JSON
                }
              }
            }
          });

          res.on('end', () => {
            const tokenUsage = extractStreamTokenUsage(tailData);
            options.onComplete(tokenUsage, accumulatedText);
            options.reply.raw.end();
            resolve();
          });

          res.on('error', (error) => {
            handleStreamError(`Stream error: ${error.message}`);
          });
        }
      );

      req.on('error', (error) => {
        handleStreamError(`Request failed: ${error.message}`);
      });

      req.on('timeout', () => {
        req.destroy();
        handleStreamError('Request timeout');
      });

      req.write(bodyStr);
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
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
  provider?: 'openai' | 'anthropic';
}

/**
 * Token usage extracted from streaming SSE events.
 */
export interface StreamTokenUsage {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function buildOpenAIEndpoint(baseUrl: string): URL {
  const basePath = baseUrl.endsWith('/')
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const hasVersionedSuffix = /(?:\/v\d+(?:\.\d+)?)$|(?:\/paas\/v\d+(?:\.\d+)?)$/.test(basePath);
  const urlPath = hasVersionedSuffix
    ? '/chat/completions'
    : '/v1/chat/completions';

  return new URL(`${basePath}${urlPath}`);
}

/**
 * Extract token usage from the tail of an SSE stream.
 * Handles both OpenAI and Anthropic streaming formats.
 */
export /**
 * Coerce a loosely-typed streamed JSON value to an optional number.
 * Passing parsed-JSON `any` values through this `unknown` sink avoids
 * no-unsafe-assignment while keeping a runtime type guard.
 */
function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Coerce a loosely-typed streamed JSON value to an optional string.
 * Used to feed tool-call arguments / reasoning content into the token-usage
 * fallback estimator (which needs text to count).
 */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function extractStreamTokenUsage(tail: string): StreamTokenUsage | undefined {
  // OpenAI format: "usage":{"prompt_tokens":X,"completion_tokens":Y,"total_tokens":Z}
  const openaiMatch = tail.match(/"total_tokens"\s*:\s*(\d+)/);
  if (openaiMatch) {
    const totalTokens = parseInt(openaiMatch[1]!, 10);
    const promptMatch = tail.match(/"prompt_tokens"\s*:\s*(\d+)/);
    const completionMatch = tail.match(/"completion_tokens"\s*:\s*(\d+)/);
    const inputTokens = promptMatch ? parseInt(promptMatch[1]!, 10) : undefined;
    const outputTokens = completionMatch ? parseInt(completionMatch[1]!, 10) : undefined;
    return { totalTokens, inputTokens, outputTokens };
  }

  // Anthropic format: look for input_tokens and output_tokens in separate events
  const inputMatch = tail.match(/"input_tokens"\s*:\s*(\d+)/);
  const outputMatch = tail.match(/"output_tokens"\s*:\s*(\d+)/);
  if (inputMatch || outputMatch) {
    const inputTokens = inputMatch ? parseInt(inputMatch[1]!, 10) : 0;
    const outputTokens = outputMatch ? parseInt(outputMatch[1]!, 10) : 0;
    return { totalTokens: inputTokens + outputTokens, inputTokens, outputTokens };
  }

  return undefined;
}

/**
 * Merge tail-extracted usage with values captured while streaming.
 *
 * Captured values (seen in message_start / message_delta / the OpenAI usage
 * chunk) take precedence, because the 4KB tail can evict Anthropic's
 * message_start event — losing input_tokens — on long generations.
 */
export function mergeStreamTokenUsage(
  tail: StreamTokenUsage | undefined,
  capturedInputTokens?: number,
  capturedOutputTokens?: number
): StreamTokenUsage | undefined {
  if (capturedInputTokens === undefined && capturedOutputTokens === undefined) {
    return tail;
  }
  const inputTokens = capturedInputTokens ?? tail?.inputTokens ?? 0;
  const outputTokens = capturedOutputTokens ?? tail?.outputTokens ?? 0;
  return { totalTokens: inputTokens + outputTokens, inputTokens, outputTokens };
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
    const url = buildOpenAIEndpoint(options.baseUrl);
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
    const url = buildOpenAIEndpoint(options.baseUrl);
    const startTime = Date.now();

    logger.debug('Forwarding OpenAI streaming request', {
      requestId: options.requestId,
      url: url.toString(),
      model: request.model,
    });

    await this.makeStreamingRequest({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'bearer',
      provider: 'openai',
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

    await this.makeStreamingRequest({
      url,
      method: 'POST',
      apiKey: options.apiKey,
      body: request,
      timeout: options.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
      authType: 'x-api-key',
      provider: 'anthropic',
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
      const handleStreamError = (errorMessage: string, statusCode?: number): void => {
        if (options.reply.raw.headersSent) {
          try {
            options.reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`);
          } catch {
            // Ignore write errors on closed connections
          }
          options.reply.raw.end();
        }
        // Attach upstream statusCode so callers can decide whether to failover
        // (e.g. 429 = rate/quota limit is retryable on another plan).
        const err = new Error(errorMessage) as Error & { statusCode?: number };
        if (statusCode !== undefined) {
          err.statusCode = statusCode;
        }
        reject(err);
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
              handleStreamError(`Upstream error: ${res.statusCode} - ${data.slice(0, 500)}`, res.statusCode);
            });
            return;
          }

          // Forward chunks manually instead of piping, to extract token usage from tail
          let tailData = '';
          let sseBuffer = '';
          let accumulatedText = '';
          // Capture token usage as it streams by. The tail-based extraction
          // below only sees the last 4KB, which evicts Anthropic's message_start
          // event (it carries input_tokens at the very start of the stream) on
          // long generations — so input_tokens was systematically lost. Capturing
          // here and merging on 'end' preserves it regardless of stream length.
          let capturedInputTokens: number | undefined;
          let capturedOutputTokens: number | undefined;
          let sseHeadersSent = false;

          const ensureSseHeaders = (): void => {
            if (!sseHeadersSent) {
              // Hijack the reply only when we are certain the upstream is
              // sending a successful stream.  If the upstream returned an
              // error before the first data chunk the handler will throw
              // and Fastify's normal error pipeline sends the response.
              options.reply.hijack();
              options.reply.raw.setHeader('Content-Type', 'text/event-stream');
              options.reply.raw.setHeader('Cache-Control', 'no-cache');
              options.reply.raw.setHeader('Connection', 'keep-alive');
              sseHeadersSent = true;
            }
          };

          let isDrained = true;

          // Backpressure: pause upstream when the client cannot keep up
          options.reply.raw.on('drain', () => {
            isDrained = true;
            if (res.isPaused()) {
              res.resume();
            }
          });

          res.on('data', (chunk: Buffer) => {
            ensureSseHeaders();
            isDrained = options.reply.raw.write(chunk);
            if (!isDrained) {
              res.pause();
            }

            // Consolidate buffering: extract lines from chunk
            sseBuffer += chunk.toString();
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
              const lineWithNewline = line + '\n';
              tailData += lineWithNewline;
              if (tailData.length > 4096) {
                tailData = tailData.slice(-4096);
              }

              if (options.provider && /^data:\s+/.test(line) && line.trim() !== 'data: [DONE]') {
                // Cheap pre-check to avoid JSON.parse overhead. Parse lines that
                // carry content OR token usage (message_start / message_delta /
                // the final OpenAI usage chunk).
                const hasContent = options.provider === 'openai'
                  ? (line.includes('"content"') || line.includes('"tool_calls"') || line.includes('"reasoning_content"'))
                  : line.includes('"delta"');
                const hasUsage = line.includes('"input_tokens"')
                  || line.includes('"output_tokens"')
                  || line.includes('"prompt_tokens"')
                  || line.includes('"completion_tokens"');
                if (!hasContent && !hasUsage) {
                  continue;
                }

                try {
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                  const data = JSON.parse(line.replace(/^data:\s+/, ''));
                  if (options.provider === 'openai') {
                    // OpenAI format
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const contentDelta = asOptionalString(data.choices?.[0]?.delta?.content);
                    if (contentDelta) {
                      accumulatedText += contentDelta;
                    }
                    // Reasoning content (e.g. DeepSeek) counts toward output.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    const reasoning = asOptionalString(data.choices?.[0]?.delta?.reasoning_content);
                    if (reasoning) {
                      accumulatedText += reasoning;
                    }
                    // Tool-call argument deltas are the bulk of coding-agent
                    // output; feed them into accumulatedText so the token-usage
                    // fallback estimator has text to count when the upstream
                    // omits a usage chunk.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
                    const toolCalls = data.choices?.[0]?.delta?.tool_calls;
                    if (Array.isArray(toolCalls)) {
                      for (const tc of toolCalls) {
                        const args = asOptionalString(
                          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                          tc?.function?.arguments
                        );
                        if (args) {
                          accumulatedText += args;
                        }
                      }
                    }
                    // Final usage chunk (only present if stream_options.include_usage)
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (data.usage) {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      const inT = asOptionalNumber(data.usage.prompt_tokens);
                      if (inT !== undefined) {
                        capturedInputTokens = inT;
                      }
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      const outT = asOptionalNumber(data.usage.completion_tokens);
                      if (outT !== undefined) {
                        capturedOutputTokens = outT;
                      }
                    }
                  } else if (options.provider === 'anthropic') {
                    // Anthropic format
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (data.type === 'content_block_delta' && data.delta?.text) {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      accumulatedText += asOptionalString(data.delta.text) ?? '';
                    }
                    // Tool-use argument deltas (input_json_delta) are the bulk
                    // of tool-call output; feed them into accumulatedText so
                    // the fallback estimator has text to count.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (data.type === 'input_json_delta') {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      accumulatedText += asOptionalString(data.delta?.partial_json) ?? '';
                    }
                    // input_tokens arrive once, in the message_start event at the
                    // very start of the stream — capture them before the tail
                    // evicts that event on long generations.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (data.type === 'message_start' && data.message?.usage) {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      const inT = asOptionalNumber(data.message.usage.input_tokens);
                      if (inT !== undefined) {
                        capturedInputTokens = inT;
                      }
                    }
                    // output_tokens are finalized in the terminal message_delta.
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (data.type === 'message_delta' && data.usage) {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                      const outT = asOptionalNumber(data.usage.output_tokens);
                      if (outT !== undefined) {
                        capturedOutputTokens = outT;
                      }
                    }
                  }
                } catch {
                  // ignore partial or invalid JSON
                }
              }
            }
          });

          res.on('end', () => {
            // Append any remaining buffer data to tailData
            if (sseBuffer) {
              tailData += sseBuffer;
              if (tailData.length > 4096) {
                tailData = tailData.slice(-4096);
              }
            }
            const tokenUsage = mergeStreamTokenUsage(extractStreamTokenUsage(tailData), capturedInputTokens, capturedOutputTokens);
            options.onComplete(tokenUsage, accumulatedText);
            options.reply.raw.end();
            cleanupClientClose();
            resolve();
          });

          res.on('error', (error) => {
            handleStreamError(`Stream error: ${error.message}`);
            cleanupClientClose();
          });
        }
      );

      // Abort the upstream request when the client disconnects
      let clientClosed = false;
      const onClientClose = (): void => {
        if (!clientClosed) {
          clientClosed = true;
          if (!req.destroyed) {
            req.destroy();
          }
        }
      };
      const cleanupClientClose = (): void => {
        options.reply.raw.removeListener('close', onClientClose);
      };
      options.reply.raw.on('close', onClientClose);

      req.on('error', (error) => {
        handleStreamError(`Request failed: ${error.message}`);
        cleanupClientClose();
      });

      req.on('timeout', () => {
        req.destroy();
        handleStreamError('Request timeout');
        cleanupClientClose();
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

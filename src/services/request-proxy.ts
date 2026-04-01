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
}

/**
 * Options for internal streaming requests.
 */
interface InternalStreamingOptions extends InternalRequestOptions {
  reply: FastifyReply;
  onComplete: () => void;
}

/**
 * Build request headers.
 */
function buildHeaders(
  apiKey: string,
  extraHeaders?: Record<string, string>,
  isStreaming?: boolean
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': DEFAULT_USER_AGENT,
  };

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
      timeout: options.timeout ?? 30,
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
    reply: FastifyReply
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
      timeout: options.timeout ?? 60,
      reply,
      onComplete: () => {
        onChunk('', true);
        const durationMs = Date.now() - startTime;
        logger.info('OpenAI streaming request completed', {
          requestId: options.requestId,
          durationMs,
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
      timeout: options.timeout ?? 30,
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
   * Forward an Anthropic-format streaming request.
   */
  async forwardAnthropicStream(
    request: AnthropicMessageRequest,
    options: ProxyRequestOptions,
    onChunk: StreamCallback,
    reply: FastifyReply
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
      timeout: options.timeout ?? 60,
      extraHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      reply,
      onComplete: () => {
        onChunk('', true);
        const durationMs = Date.now() - startTime;
        logger.info('Anthropic streaming request completed', {
          requestId: options.requestId,
          durationMs,
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
      const headers = buildHeaders(options.apiKey, options.extraHeaders);
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
      const headers = buildHeaders(options.apiKey, options.extraHeaders, true);
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

          res.pipe(options.reply.raw);

          res.on('end', () => {
            options.onComplete();
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
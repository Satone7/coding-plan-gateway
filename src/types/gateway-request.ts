/**
 * Internal request types for gateway processing.
 * Used for transforming and routing requests between API formats.
 */

/**
 * Message role types (unified across formats)
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * Content block types for multimodal messages
 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    media_type?: string;
    data: string;
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock;

/**
 * Unified message structure for internal processing.
 */
export interface GatewayMessage {
  role: MessageRole;
  content: string | ContentBlock[];
  name?: string;
}

/**
 * GatewayRequest - Internal unified request format.
 *
 * This is the canonical request structure used internally by the gateway,
 * converted from either OpenAI or Anthropic format.
 */
export interface GatewayRequest {
  /** Model identifier */
  model: string;

  /** Conversation messages */
  messages: GatewayMessage[];

  /** Enable streaming response */
  stream: boolean;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Sampling temperature */
  temperature?: number;

  /** Nucleus sampling parameter */
  topP?: number;

  /** Stop sequences */
  stop?: string[];

  /** System prompt (Anthropic-specific) */
  system?: string;

  /** Additional provider-specific parameters */
  metadata?: Record<string, unknown>;
}

/**
 * GatewayResponse - Internal unified response format.
 */
export interface GatewayResponse {
  /** Response ID */
  id: string;

  /** Model used */
  model: string;

  /** Generated content */
  content: string;

  /** Stop reason */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null;

  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };

  /** Response duration in milliseconds */
  durationMs: number;
}

/**
 * Streaming chunk for SSE responses.
 */
export interface GatewayStreamChunk {
  /** Response ID */
  id: string;

  /** Model used */
  model: string;

  /** Delta content */
  delta: string;

  /** Is this the final chunk? */
  isComplete: boolean;

  /** Stop reason (only on final chunk) */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
}

/**
 * Routing context attached to requests during processing.
 */
export interface RoutingContext {
  /** Request ID for tracing */
  requestId: string;

  /** Timestamp when request was received */
  receivedAt: Date;

  /** Selected coding plan ID */
  selectedPlanId?: string;

  /** Original request format */
  sourceFormat: 'openai' | 'anthropic';

  /** Client IP address */
  clientIp?: string;
}

/**
 * Error codes for gateway responses.
 */
export type GatewayErrorCode =
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'QUOTA_EXHAUSTED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Gateway error response structure.
 */
export interface GatewayError {
  message: string;
  type: string;
  code: GatewayErrorCode;
  details?: Record<string, unknown>;
}

/**
 * Create a gateway error response.
 */
export function createGatewayError(
  code: GatewayErrorCode,
  message: string,
  details?: Record<string, unknown>
): GatewayError {
  const errorTypes: Record<GatewayErrorCode, string> = {
    INVALID_REQUEST: 'validation_error',
    MODEL_NOT_FOUND: 'not_found',
    PLAN_NOT_FOUND: 'not_found',
    QUOTA_EXHAUSTED: 'quota_error',
    UPSTREAM_ERROR: 'upstream_error',
    UPSTREAM_TIMEOUT: 'timeout_error',
    SERVICE_UNAVAILABLE: 'service_error',
    INTERNAL_ERROR: 'internal_error',
  };

  return {
    message,
    type: errorTypes[code],
    code,
    details,
  };
}
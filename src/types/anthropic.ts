/**
 * Anthropic API types for request/response handling.
 * @see https://docs.anthropic.com/claude/reference/messages_post
 */

/**
 * Anthropic message role types
 */
export type AnthropicMessageRole = 'user' | 'assistant';

/**
 * Anthropic content block types
 */
export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    media_type: string;
    data: string;
  };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

/**
 * Anthropic message structure.
 */
export interface AnthropicMessage {
  role: AnthropicMessageRole;
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic messages API request.
 */
export interface AnthropicMessageRequest {
  /** Model identifier */
  model: string;

  /** Conversation messages */
  messages: AnthropicMessage[];

  /** Maximum tokens to generate (required) */
  max_tokens: number;

  /** Enable streaming response */
  stream?: boolean;

  /** System prompt */
  system?: string;

  /** Sampling temperature (0-1) */
  temperature?: number;

  /** Top-k sampling */
  top_k?: number;

  /** Top-p (nucleus) sampling */
  top_p?: number;

  /** Stop sequences */
  stop_sequences?: string[];

  /** Metadata for tracking */
  metadata?: {
    user_id?: string;
  };
}

/**
 * Anthropic messages API response.
 */
export interface AnthropicMessageResponse {
  /** Response ID */
  id: string;

  /** Object type */
  type: 'message';

  /** Role (always assistant) */
  role: 'assistant';

  /** Generated content blocks */
  content: AnthropicTextBlock[];

  /** Model used */
  model: string;

  /** Stop reason */
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null;

  /** Stop sequence that matched (if any) */
  stop_sequence: string | null;

  /** Token usage */
  usage: AnthropicUsage;
}

/**
 * Anthropic token usage.
 */
export interface AnthropicUsage {
  /** Input tokens */
  input_tokens: number;

  /** Output tokens */
  output_tokens: number;
}

/**
 * Anthropic streaming message start event.
 */
export interface AnthropicMessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    content: [];
    stop_reason: null;
    stop_sequence: null;
    usage: AnthropicUsage;
  };
}

/**
 * Anthropic streaming content block start event.
 */
export interface AnthropicContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: AnthropicTextBlock;
}

/**
 * Anthropic streaming content block delta event.
 */
export interface AnthropicContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

/**
 * Anthropic streaming content block stop event.
 */
export interface AnthropicContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

/**
 * Anthropic streaming message delta event.
 */
export interface AnthropicMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

/**
 * Anthropic streaming message stop event.
 */
export interface AnthropicMessageStop {
  type: 'message_stop';
}

/**
 * All Anthropic streaming event types.
 */
export type AnthropicStreamEvent =
  | AnthropicMessageStart
  | AnthropicContentBlockStart
  | AnthropicContentBlockDelta
  | AnthropicContentBlockStop
  | AnthropicMessageDelta
  | AnthropicMessageStop;

/**
 * Anthropic error response.
 */
export interface AnthropicError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/**
 * Check if a request is an Anthropic format request.
 */
export function isAnthropicRequest(request: unknown): request is AnthropicMessageRequest {
  if (typeof request !== 'object' || request === null) return false;
  const req = request as Record<string, unknown>;
  return (
    typeof req.model === 'string' &&
    Array.isArray(req.messages) &&
    typeof req.max_tokens === 'number'
  );
}
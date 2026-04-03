/**
 * OpenAI API types for request/response handling.
 * @see https://platform.openai.com/docs/api-reference/chat
 */

/**
 * OpenAI message role types
 */
export type OpenAIMessageRole = 'system' | 'user' | 'assistant';

/**
 * OpenAI multimodal content block
 */
export interface MultimodalContentBlock {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * OpenAI chat message structure.
 */
export interface ChatMessage {
  role: OpenAIMessageRole;
  content: string | MultimodalContentBlock[];
  name?: string;
}

/**
 * OpenAI chat completion request.
 */
export interface ChatCompletionRequest {
  /** Model identifier */
  model: string;

  /** Conversation messages */
  messages: ChatMessage[];

  /** Enable streaming response */
  stream?: boolean;

  /** Maximum tokens to generate */
  max_tokens?: number;

  /** Sampling temperature (0-2) */
  temperature?: number;

  /** Nucleus sampling parameter (0-1) */
  top_p?: number;

  /** Number of completions to generate */
  n?: number;

  /** Stop sequences */
  stop?: string | string[];

  /** Presence penalty (-2.0 to 2.0) */
  presence_penalty?: number;

  /** Frequency penalty (-2.0 to 2.0) */
  frequency_penalty?: number;

  /** Logit bias */
  logit_bias?: Record<string, number>;

  /** User identifier for abuse monitoring */
  user?: string;
}

/**
 * OpenAI chat completion response.
 */
export interface ChatCompletionResponse {
  /** Response ID */
  id: string;

  /** Object type */
  object: 'chat.completion';

  /** Creation timestamp (Unix) */
  created: number;

  /** Model used */
  model: string;

  /** Completion choices */
  choices: ChatCompletionChoice[];

  /** Token usage */
  usage: Usage;
}

/**
 * OpenAI chat completion choice.
 */
export interface ChatCompletionChoice {
  /** Choice index */
  index: number;

  /** Generated message */
  message: ChatMessage;

  /** Reason for completion */
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

/**
 * OpenAI streaming chat completion chunk.
 */
export interface ChatCompletionChunk {
  /** Response ID */
  id: string;

  /** Object type */
  object: 'chat.completion.chunk';

  /** Creation timestamp (Unix) */
  created: number;

  /** Model used */
  model: string;

  /** Choice deltas */
  choices: ChatCompletionChunkChoice[];
}

/**
 * OpenAI streaming chunk choice.
 */
export interface ChatCompletionChunkChoice {
  /** Choice index */
  index: number;

  /** Delta content */
  delta: {
    role?: OpenAIMessageRole;
    content?: string;
  };

  /** Reason for completion */
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

/**
 * OpenAI token usage.
 */
export interface Usage {
  /** Input tokens */
  prompt_tokens: number;

  /** Output tokens */
  completion_tokens: number;

  /** Total tokens */
  total_tokens: number;
}

/**
 * OpenAI models list response.
 */
export interface ModelsResponse {
  /** Object type */
  object: 'list';

  /** Available models */
  data: Model[];
}

/**
 * OpenAI model object.
 */
export interface Model {
  /** Model ID */
  id: string;

  /** Object type */
  object: 'model';

  /** Creation timestamp (Unix) */
  created: number;

  /** Owner */
  owned_by: string;
}

/**
 * OpenAI error response.
 */
export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

/**
 * Transform OpenAI request to internal format helper.
 */
export function isOpenAIRequest(request: unknown): request is ChatCompletionRequest {
  if (typeof request !== 'object' || request === null) {
    return false;
  }
  const req = request as Record<string, unknown>;
  return typeof req.model === 'string' && Array.isArray(req.messages);
}
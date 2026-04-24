/**
 * OpenAI API types for request/response handling.
 * @see https://platform.openai.com/docs/api-reference/chat
 */

/**
 * OpenAI message role types.
 * Includes 'tool' for function calling responses.
 * 'function' is deprecated but still supported for backward compatibility.
 */
export type OpenAIMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

/**
 * OpenAI tool call object (in assistant messages).
 */
export interface ToolCall {
  /** Tool call ID */
  id: string;
  /** Tool type (currently only 'function') */
  type: 'function';
  /** Function details */
  function: {
    /** Function name */
    name: string;
    /** Function arguments as JSON string */
    arguments: string;
  };
}

/**
 * OpenAI multimodal content block
 */
export type MultimodalContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url?: { url: string; detail?: 'auto' | 'low' | 'high' } };

/**
 * OpenAI chat message structure.
 * Supports tool calling with tool role and tool_calls array.
 */
export interface ChatMessage {
  /** Message role */
  role: OpenAIMessageRole;
  /** Message content (can be null/undefined for assistant messages with tool_calls) */
  content?: string | MultimodalContentBlock[] | null;
  /** Optional name for user/assistant/function messages */
  name?: string;
  /** Tool call ID (required for tool role messages) */
  tool_call_id?: string;
  /** Tool calls (optional, for assistant messages) */
  tool_calls?: ToolCall[];
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
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
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
 * OpenAI streaming chunk delta (supports tool_calls streaming).
 */
export interface ChatCompletionChunkDelta {
  /** Role (only in first chunk) */
  role?: OpenAIMessageRole;
  /** Content delta */
  content?: string;
  /** Tool calls delta (for streaming function calls) */
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

/**
 * OpenAI streaming chunk choice.
 */
export interface ChatCompletionChunkChoice {
  /** Choice index */
  index: number;

  /** Delta content */
  delta: ChatCompletionChunkDelta;

  /** Reason for completion */
  finish_reason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
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

  /** Context window size in tokens (optional, gateway extension) */
  context_window?: number;

  /** Maximum output tokens (optional, gateway extension) */
  max_output_tokens?: number;

  /** Supports vision/multimodal (optional, gateway extension) */
  supports_vision?: boolean;

  /** Supports function calling/tools (optional, gateway extension) */
  supports_tools?: boolean;

  /** Provider source (optional, gateway extension) */
  provider?: string;
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
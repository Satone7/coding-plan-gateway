/**
 * Model context window and capabilities configuration.
 * Data sourced from official provider documentation.
 *
 * @module config/model-info
 */

/**
 * Model capability metadata.
 */
export interface ModelInfo {
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens (if known) */
  maxOutputTokens?: number;
  /** Model notes/description */
  notes?: string;
  /** Supports vision/multimodal */
  supportsVision?: boolean;
  /** Supports function calling/tools */
  supportsTools?: boolean;
  /** Supports streaming */
  supportsStreaming?: boolean;
}

/**
 * Provider-specific model information.
 */
export const MODEL_INFO: Record<string, Record<string, ModelInfo>> = {
  zhipu: {
    'glm-4-flash': {
      contextWindow: 128000,
      notes: 'Free, fast inference',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4': {
      contextWindow: 128000,
      notes: 'Standard version',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4-plus': {
      contextWindow: 128000,
      notes: 'Enhanced performance',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4-air': {
      contextWindow: 128000,
      notes: 'Lightweight, fast',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4-airx': {
      contextWindow: 128000,
      notes: 'High-speed version',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4-long': {
      contextWindow: 1000000,
      notes: 'Ultra-long context (1M tokens)',
      supportsStreaming: true,
    },
    'glm-4v': {
      contextWindow: 128000,
      supportsVision: true,
      notes: 'Multimodal vision model',
      supportsStreaming: true,
    },
    'glm-4v-plus': {
      contextWindow: 128000,
      supportsVision: true,
      notes: 'Enhanced multimodal',
      supportsStreaming: true,
    },
    'glm-5': {
      contextWindow: 200000,
      notes: 'Released Feb 2026',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5-turbo': {
      contextWindow: 200000,
      maxOutputTokens: 128000,
      notes: 'Released Mar 2026, Agent-optimized',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5.1': {
      contextWindow: 200000,
      notes: 'Released Mar 2026, flagship model',
      supportsTools: true,
      supportsStreaming: true,
    },
  },

  volcengine: {
    'ark-code-latest': {
      contextWindow: 128000,
      notes: 'Code-focused routing model',
      supportsTools: true,
      supportsStreaming: true,
    },
    'doubao-seed-2.0-code': {
      contextWindow: 262144,
      notes: 'Doubao seed code generation model',
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
    },
    'kimi-k2.5': {
      contextWindow: 256000,
      notes: 'Moonshot AI model, 1T params MoE, 32B active',
      supportsTools: true,
      supportsStreaming: true,
    },
    'kimi-k2.6': {
      contextWindow: 256000,
      notes: 'Latest Kimi, code capabilities enhanced',
      supportsTools: true,
      supportsStreaming: true,
    },
    'minimax-m2.5': {
      contextWindow: 1000000,
      notes: 'MiniMax model with 1M context',
      supportsTools: true,
      supportsStreaming: true,
    },
    'minimax-m2.7': {
      contextWindow: 1000000,
      notes: 'MiniMax latest model',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4.7': {
      contextWindow: 128000,
      maxOutputTokens: 96000,
      notes: 'Zhipu model hosted on Volcengine',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5.1': {
      contextWindow: 200000,
      notes: 'Zhipu latest hosted on Volcengine',
      supportsTools: true,
      supportsStreaming: true,
    },
  },

  ali: {
    'qwen3.6-plus': {
      contextWindow: 1000000,
      notes: 'Latest Qwen coding model, 1M context',
      supportsTools: true,
      supportsStreaming: true,
    },
    'qwen3.5-plus': {
      contextWindow: 128000,
      notes: 'Qwen coding model',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5': {
      contextWindow: 200000,
      notes: 'Zhipu model on Bailian',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-4.7': {
      contextWindow: 128000,
      maxOutputTokens: 96000,
      notes: 'Zhipu model on Bailian',
      supportsTools: true,
      supportsStreaming: true,
    },
    'kimi-k2.5': {
      contextWindow: 256000,
      notes: 'Moonshot model on Bailian',
      supportsTools: true,
      supportsStreaming: true,
    },
    'MiniMax-M2.5': {
      contextWindow: 1000000,
      notes: 'MiniMax model on Bailian',
      supportsTools: true,
      supportsStreaming: true,
    },
  },
};

/**
 * Model name aliases (alternative names -> canonical names).
 */
export const MODEL_NAME_ALIASES: Record<string, string> = {
  'glm-5': 'glm-5-turbo',  // Default glm-5 points to turbo
  'glm-4v-flash': 'glm-4v',
};

/**
 * Get model info by provider and model name.
 * Handles aliases automatically.
 */
export function getModelInfo(provider: string, modelName: string): ModelInfo | undefined {
  const providerModels = MODEL_INFO[provider];
  if (!providerModels) return undefined;

  const canonicalName = MODEL_NAME_ALIASES[modelName] ?? modelName;
  return providerModels[canonicalName];
}

/**
 * Get model info from any provider (searches all providers).
 * Returns first match found.
 * Uses case-insensitive matching.
 */
export function findModelInfo(modelName: string): { provider: string; info: ModelInfo } | undefined {
  const canonicalName = MODEL_NAME_ALIASES[modelName] ?? modelName;
  const nameLower = canonicalName.toLowerCase();

  for (const [provider, models] of Object.entries(MODEL_INFO)) {
    // Try exact match first
    const info = models[canonicalName];
    if (info) {
      return { provider, info };
    }
    // Then try case-insensitive match
    for (const [key, value] of Object.entries(models)) {
      if (key.toLowerCase() === nameLower) {
        return { provider, info: value };
      }
    }
  }

  return undefined;
}
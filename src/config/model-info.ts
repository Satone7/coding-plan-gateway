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
    'glm-5.2': {
      contextWindow: 1000000,
      notes: 'Flagship with 1M context window',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5.3': {
      contextWindow: 1000000,
      notes: 'Released Aug 2026; specs mirror glm-5.2 pending official docs',
      supportsTools: true,
      supportsStreaming: true,
    },
    'glm-5.3-flash': {
      contextWindow: 1000000,
      maxOutputTokens: 128000,
      notes:
        'GLM-5 series first native multimodal (320B total/18B active); vision verified on the coding OpenAI surface via image_url.url 2026-08-27 (base64 data URLs rejected with 1214/500)',
      supportsTools: true,
      supportsStreaming: true,
      supportsVision: true,
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
    'qwen3.7-plus': {
      contextWindow: 1000000,
      notes: 'Latest Qwen coding model, 1M context',
      supportsTools: true,
      supportsStreaming: true,
    },
    'qwen3.6-plus': {
      contextWindow: 1000000,
      notes: 'Qwen coding model, 1M context',
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

  deepseek: {
    'deepseek-v4-flash': {
      contextWindow: 1000000,
      maxOutputTokens: 384000,
      notes: 'Fast inference model, 1M context',
      supportsTools: true,
      supportsStreaming: true,
    },
    'deepseek-v4-flash-Vision-Exp': {
      contextWindow: 1000000,
      maxOutputTokens: 384000,
      notes: 'Experimental vision-capable variant of deepseek-v4-flash; specs provisional pending official docs',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    'deepseek-v4-pro': {
      contextWindow: 1000000,
      maxOutputTokens: 384000,
      notes: 'Flagship model, 1M context',
      supportsTools: true,
      supportsStreaming: true,
    },
  },

  kimi: {
    // Metadata from GET /coding/v1/models (2026-07-19). The preset uses
    // dynamicModels, so new entries appear automatically; this map only adds
    // context-window/capability metadata for known models.
    'kimi-for-coding': {
      contextWindow: 262144,
      notes: 'K2.7 Coding — default coding-plan model',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    'kimi-for-coding-highspeed': {
      contextWindow: 262144,
      notes: 'K2.7 Coding Highspeed',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    k3: {
      contextWindow: 1048576,
      notes: 'K3 — 1M context, thinking efforts low/high/max',
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
    },
    'k3-256k': {
      contextWindow: 262144,
      notes: 'K3 256k context — no video input, otherwise same as k3',
      supportsVision: true,
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
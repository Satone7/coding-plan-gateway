/**
 * cc-switch provider preset mapping configuration.
 * Controls how cc-switch presets are mapped to our provider system.
 */

/**
 * Per-provider overrides applied after ID resolution.
 */
export interface ProviderOverrideConfig {
  /** Override cc-switch's baseUrl */
  baseUrl?: string;
  /** Models to add to the list (on top of cc-switch models) */
  addModels?: string[];
  /** Models to remove from the list */
  excludeModels?: string[];
}

/**
 * Mapping configuration for cc-switch preset parsing.
 */
export interface CcSwitchMapping {
  /** cc-switch preset name → our provider ID (overrides auto-generated slug) */
  idOverrides: Record<string, string>;
  /** cc-switch preset names to skip entirely */
  excludePresets: string[];
  /** Provider IDs that have a usage API adapter */
  usageApiProviders: string[];
  /** Per-provider overrides (keyed by resolved provider ID) */
  providerOverrides: Record<string, ProviderOverrideConfig>;
}

export const CC_SWITCH_MAPPING: CcSwitchMapping = {
  idOverrides: {
    'Zhipu GLM': 'zhipu',
    'Zhipu GLM en': 'zhipu-en',
    'DouBaoSeed': 'volcengine',
    'MiniMax': 'minimax',
    'MiniMax en': 'minimax-en',
    'SiliconFlow': 'siliconflow',
    'SiliconFlow en': 'siliconflow-en',
    'Bailian': 'bailian',
    'Bailian For Coding': 'ali',
    'Kimi': 'kimi',
    'Kimi For Coding': 'kimi-coding',
    'Xiaomi MiMo': 'xiaomi-mimo',
    'Novita AI': 'novita',
    'TheRouter': 'therouter',
    'OpenRouter': 'openrouter',
    'AWS Bedrock (AKSK)': 'aws-bedrock',
    'AWS Bedrock (API Key)': 'aws-bedrock-key',
    'GitHub Copilot': 'github-copilot',
    'AiHubMix': 'aihubmix',
    'DMXAPI': 'dmxapi',
    'PackyCode': 'packycode',
    'Cubence': 'cubence',
    'AIGoCode': 'aigocode',
    'RightCode': 'rightcode',
    'AICodeMirror': 'aicodemirror',
    'AICoding': 'aicoding',
    'CrazyRouter': 'crazyrouter',
    'SSSAiCode': 'sssaicode',
    'Compshare': 'compshare',
    'Micu': 'micu',
    'CTok.ai': 'ctok',
    'DDSHub': 'ddshub',
    'E-FlowCode': 'eflowcode',
    'LionCCAPI': 'lionccapi',
    'PIPELLM': 'pipellm',
  },

  excludePresets: [
    'Claude Official', // no baseUrl
    'Codex',           // OpenAI Codex, not Anthropic-compatible
    'KAT-Coder',       // template variables ${ENDPOINT_ID}
  ],

  usageApiProviders: ['zhipu'],

  providerOverrides: {
    zhipu: {
      addModels: ['glm-5.1', 'glm-5-turbo'],
      excludeModels: ['glm-4.7'],
    },
    volcengine: {
      addModels: ['doubao-seed-2.0-code', 'ark-code-latest', 'kimi-k2.5', 'minimax-m2.5', 'glm-4.7'],
    },
    ali: {
      addModels: ['qwen3.6-plus', 'qwen3.5-plus', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'MiniMax-M2.5'],
    },
    bailian: {
      addModels: ['qwen3.6-plus', 'qwen3.5-plus'],
    },
    deepseek: {
      addModels: ['DeepSeek-V3.2'],
    },
  },
};

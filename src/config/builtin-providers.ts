/**
 * Built-in provider presets.
 * Default configurations for known AI providers.
 */

import type { ProviderPreset } from '@/types';

/**
 * Built-in provider preset configurations.
 * These serve as defaults that can be overridden via config.yaml.
 */
export const BUILTIN_PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    openaiBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: ['glm-5.1', 'glm-5-turbo', 'glm-4.7'],
    defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
    hasUsageApi: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine / Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    openaiBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7', 'glm-4.7', 'glm-5.1'],
    hasUsageApi: false,
  },
  {
    id: 'ali',
    name: 'Ali / DashScope',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    openaiBaseUrl: 'https://coding.dashscope.aliyuncs.com',
    models: ['qwen3.6-plus', 'qwen3.5-plus', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'MiniMax-M2.5'],
    hasUsageApi: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    openaiBaseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    hasUsageApi: true,
  },
];

/**
 * Provider IDs for the built-in providers.
 */
export const BUILTIN_PROVIDER_IDS: readonly string[] = BUILTIN_PROVIDERS.map((p) => p.id);

/**
 * Look up a built-in provider by its ID.
 *
 * @param id - The provider ID
 * @returns The provider preset, or undefined if not found
 */
export function getBuiltinProvider(id: string): ProviderPreset | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

/**
 * Look up a built-in provider by its baseUrl (exact match, trailing-slash tolerant).
 *
 * @param baseUrl - The base URL to match against
 * @returns The provider preset, or undefined if not found
 */
export function getBuiltinProviderByBaseUrl(baseUrl: string): ProviderPreset | undefined {
  const normalized = baseUrl.replace(/\/+$/, '');
  return BUILTIN_PROVIDERS.find((p) => p.baseUrl.replace(/\/+$/, '') === normalized);
}

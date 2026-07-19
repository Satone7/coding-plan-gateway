/**
 * Built-in provider presets.
 * Default configurations for known AI providers.
 */

import type { ProviderPreset, ProviderOverride } from '@/types';

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
    models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7'],
    defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
    hasUsageApi: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine / Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    openaiBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7', 'glm-4.7', 'glm-5.1', 'glm-5.2'],
    hasUsageApi: false,
  },
  {
    id: 'ali',
    name: 'Ali / DashScope',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    openaiBaseUrl: 'https://coding.dashscope.aliyuncs.com',
    models: ['qwen3.7-plus', 'qwen3.6-plus', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'MiniMax-M2.5'],
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
  {
    id: 'kimi',
    name: 'Kimi For Coding',
    // Kimi coding-plan subscription (sk-kimi-… keys). Both Anthropic
    // (/v1/messages) and OpenAI (/v1/chat/completions) formats are served from
    // the same /coding/v1 surface; the public api.moonshot.* endpoints reject
    // these keys. Usage is queried from /coding/v1/usages (KimiUsageAdapter).
    baseUrl: 'https://api.kimi.com/coding/v1',
    openaiBaseUrl: 'https://api.kimi.com/coding/v1',
    // Catalog is small but evolves with model generations (e.g. k3) — fetch it
    // at runtime via /v1/models instead of maintaining a static list.
    models: [],
    dynamicModels: true,
    hasUsageApi: true,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA / NIM',
    // OpenAI-only upstream: NVIDIA's `integrate.api.nvidia.com` endpoint speaks
    // the OpenAI Chat Completions format only — there is no Anthropic
    // /v1/messages surface. The empty-string baseUrl is the OpenAI-only sentinel
    // (routing null-guards treat '' as "no Anthropic support"), so this preset
    // serves OpenAI-format clients exclusively. Anthropic clients such as Claude
    // Code must run an external converter (e.g. claude-code-router or LiteLLM)
    // in front of the gateway's OpenAI surface to use NVIDIA models.
    baseUrl: '',
    openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    // NVIDIA's catalog is large, vendor-namespaced (e.g. `z-ai/glm-5.2`,
    // `meta/llama-3.3-70b-instruct`) and changes frequently — fetch it at
    // runtime via /v1/models instead of maintaining a static list.
    models: [],
    dynamicModels: true,
    modelsExclude: ['embed', 'rerank'],
    hasUsageApi: false,
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

/**
 * Merge a config-level provider override into a preset.
 *
 * - When `existing` is provided (override targets a built-in provider), the override
 *   fields are applied on top of the built-in defaults.
 * - When `existing` is undefined (new custom provider), the override must supply a
 *   `name`, at least one endpoint URL (`baseUrl` or `openaiBaseUrl`), and either
 *   `models` or `dynamicModels: true`. Returns null if invalid (caller skips).
 *
 * Shared by ProviderRegistry (runtime) and buildCustomProvidersMap (config load) so
 * both code paths apply identical merge semantics.
 */
export function mergeProviderOverride(
  id: string,
  override: ProviderOverride,
  existing?: ProviderPreset
): ProviderPreset | null {
  if (existing) {
    return {
      id,
      name: override.name ?? existing.name,
      baseUrl: override.baseUrl ?? existing.baseUrl,
      openaiBaseUrl: override.openaiBaseUrl ?? existing.openaiBaseUrl,
      models: override.models ?? existing.models,
      defaultModelAliases: override.defaultModelAliases ?? existing.defaultModelAliases,
      hasUsageApi: override.hasUsageApi ?? existing.hasUsageApi,
      dynamicModels: override.dynamicModels ?? existing.dynamicModels,
      modelsExclude: override.modelsExclude ?? existing.modelsExclude,
      category: existing.category,
    };
  }

  // New custom provider: require name + at least one URL + (models or dynamicModels).
  const hasUrl = !!override.baseUrl || !!override.openaiBaseUrl;
  const hasModels = !!override.models || override.dynamicModels === true;
  if (!override.name || !hasUrl || !hasModels) {
    return null;
  }

  return {
    id,
    name: override.name,
    // Empty-string sentinel for OpenAI-only providers; routing null-guards treat '' as absent.
    baseUrl: override.baseUrl ?? '',
    openaiBaseUrl: override.openaiBaseUrl,
    models: override.models ?? [],
    defaultModelAliases: override.defaultModelAliases,
    hasUsageApi: override.hasUsageApi ?? false,
    dynamicModels: override.dynamicModels,
    modelsExclude: override.modelsExclude,
  };
}

/**
 * Provider preset types.
 * Defines the structure for built-in and user-configured provider presets.
 */

/**
 * Provider category for classification.
 * Includes all categories from cc-switch.
 */
export type ProviderCategory =
  | 'official'
  | 'cn_official'
  | 'aggregator'
  | 'third_party'
  | 'cloud_provider'
  | 'custom';

/**
 * API format for provider requests.
 */
export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses';

/**
 * A provider preset with default configuration values.
 * Referenced by plans via the `provider` field.
 */
export interface ProviderPreset {
  /** Unique provider identifier (e.g., 'zhipu', 'volcengine') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Default API base URL for this provider */
  baseUrl: string;
  /** Default model list available from this provider */
  models: string[];
  /** Default model aliases for this provider (alias -> canonical) */
  defaultModelAliases?: Record<string, string>;
  /** Whether this provider exposes a usage query API */
  hasUsageApi: boolean;
  /** Provider category for classification */
  category?: ProviderCategory;
  /** API format override (e.g., 'openai_chat' for providers using OpenAI format) */
  apiFormat?: ApiFormat;
}
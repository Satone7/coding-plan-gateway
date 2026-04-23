/**
 * Provider preset types.
 * Defines the structure for built-in and user-configured provider presets.
 */

/**
 * Provider category for classification.
 */
export type ProviderCategory = 'aggregator' | 'cn_official' | 'third_party';

/**
 * A provider preset with default configuration values.
 * Referenced by plans via the `provider` field.
 */
export interface ProviderPreset {
  /** Unique provider identifier (e.g., 'zhipu', 'volcengine') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Default API base URL for this provider (Anthropic format) */
  baseUrl: string;
  /** OpenAI-format base URL for this provider. If set, enables OpenAI-format request forwarding. */
  openaiBaseUrl?: string;
  /** Default model list available from this provider */
  models: string[];
  /** Default model aliases for this provider (alias -> canonical) */
  defaultModelAliases?: Record<string, string>;
  /** Whether this provider exposes a usage query API */
  hasUsageApi: boolean;
  /** Provider category for classification */
  category?: ProviderCategory;
  /** API format override (e.g., 'openai_chat' for providers using OpenAI format) */
  apiFormat?: 'anthropic' | 'openai_chat';
}

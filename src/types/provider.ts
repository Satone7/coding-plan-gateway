/**
 * Provider preset types.
 * Defines the structure for built-in and user-configured provider presets.
 */

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
  /** Provider category (from cc-switch): cn_official | aggregator | third_party | cloud_provider */
  category?: string;
  /** API format: 'anthropic' (default) | 'openai_chat' | 'openai_responses' */
  apiFormat?: string;
}

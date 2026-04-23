/**
 * CodingPlan entity - represents an AI provider subscription configuration.
 * @see data-model.md for entity definitions
 */

/**
 * Quota reset period type discriminator values
 */
export type QuotaPeriodType = '5h' | 'weekly' | 'monthly' | 'total';

/**
 * 5-hour sliding window quota period.
 * Resets every 5 hours from the last reset time.
 * `sliding` and `windowHours` reserved for future fixed-time mode.
 */
export interface FiveHourPeriod {
  type: '5h';
  windowHours: number;
  sliding: true;
}

/**
 * Weekly fixed-weekday quota period.
 * Resets at 00:00 UTC on the configured weekday.
 * weekday: 1 (Monday) through 7 (Sunday), ISO 8601 convention.
 */
export interface WeeklyPeriod {
  type: 'weekly';
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/**
 * Monthly fixed-day quota period.
 * Resets at 00:00 UTC on the configured day of month.
 * If the day doesn't exist in a month, uses the last day of that month.
 */
export interface MonthlyPeriod {
  type: 'monthly';
  expiresOn?: number;
}

/**
 * Total (lifetime) quota period — never resets.
 */
export interface TotalPeriod {
  type: 'total';
}

/**
 * Quota period discriminated union.
 * Use the `type` field to discriminate between period kinds.
 */
export type QuotaPeriod = FiveHourPeriod | WeeklyPeriod | MonthlyPeriod | TotalPeriod;

/**
 * Legacy quota period string values (pre-migration).
 * Used internally for backward-compatible migration only.
 */
export type LegacyQuotaPeriod = 'daily' | 'monthly' | 'total';

/**
 * Plan operational status
 */
export type PlanStatus = 'active' | 'paused' | 'error' | 'exhausted';

/**
 * Quota configuration for a coding plan
 */
export interface QuotaConfig {
  /** Maximum allowed usage */
  limit: number;
  /** Quota reset period (structured discriminated union) */
  period: QuotaPeriod;
  /** Expiration day of month (for monthly periods). Kept for backward compatibility;
   *  prefer the `expiresOn` field inside the period object as source of truth. */
  expiresOn?: number;
  /** Expiration timestamp (ISO datetime string). Kept for backward compatibility;
   *  prefer the `expiresAt` field inside the period object as source of truth. */
  expiresAt?: string;
}

/**
 * CodingPlan - Represents an AI provider subscription configuration.
 *
 * This interface defines the structure for managing multiple coding plan
 * subscriptions, including their API endpoints, supported models, and
 * quota configurations.
 *
 * @example
 * ```typescript
 * const plan: CodingPlan = {
 *   id: 1,
 *   name: 'Kimi K2.5 Plan',
 *   baseUrl: 'https://api.moonshot.cn/v1',
 *   apiKeyEncrypted: 'enc:...',
 *   models: ['kimi-k2.5', 'kimi-k2'],
 *   quota: { limit: 1000, period: { type: 'monthly', expiresOn: 28 } },
 *   timeout: 30,
 *   status: 'active',
 *   weight: 2, // Higher priority for load balancing
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 * };
 * ```
 */
export interface CodingPlan {
  /** Unique identifier (auto-incremented integer) */
  id: number;

  /** Human-readable name for the plan */
  name: string;

  /** Base URL for the provider API */
  baseUrl: string;

  /** Encrypted API key (AES-256-GCM) */
  apiKeyEncrypted: string;

  /** List of model identifiers this plan supports */
  models: string[];

  /** Quota configuration */
  quota: QuotaConfig;

  /** Request timeout in seconds */
  timeout: number;

  /** Current operational status */
  status: PlanStatus;

  /** Day of month when quota resets/expires (1-31). Use last day of month if day doesn't exist. */
  expiresOn?: number;

  /** Exact ISO 8601 datetime for one-time expiration. Takes precedence over expiresOn. */
  expiresAt?: string;

  /** Load balancing weight (1-100, default 1). Higher values = higher priority. */
  weight?: number;

  /** Whether the plan is enabled. Temporarily disable without deleting. */
  enable?: boolean;

  /** Model aliases specific to this plan. Maps user-provided alias to canonical model name. */
  modelAliases?: Record<string, string>;

  /** Provider preset ID. When set, baseUrl/models/quota use preset defaults if not specified. */
  provider?: string;

  /** OpenAI-format base URL for this plan. Used when forwarding OpenAI-format requests.
   * If not set, OpenAI-format requests will be rejected with SERVICE_UNAVAILABLE error. */
  openaiBaseUrl?: string;

  /** Upstream API format. Determines which forwarding method and URL path to use. */
  apiFormat?: 'anthropic' | 'openai_chat';

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * CodingPlan input for creation (without system-generated fields)
 */
export interface CreateCodingPlanInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  quota: QuotaConfig;
  timeout?: number;
  expiresOn?: number;
  expiresAt?: string;
  weight?: number;
  enable?: boolean;
  modelAliases?: Record<string, string>;
  provider?: string;
}

/**
 * CodingPlan input for updates (partial updates allowed)
 */
export interface UpdateCodingPlanInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  quota?: Partial<QuotaConfig>;
  timeout?: number;
  status?: Exclude<PlanStatus, 'error' | 'exhausted'>;
  expiresOn?: number;
  expiresAt?: string;
  weight?: number;
  enable?: boolean;
  modelAliases?: Record<string, string>;
  provider?: string;
}

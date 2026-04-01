/**
 * CodingPlan entity - represents an AI provider subscription configuration.
 * @see data-model.md for entity definitions
 */

/**
 * Quota reset period types
 */
export type QuotaPeriod = 'daily' | 'monthly' | 'total';

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
  /** Quota reset period */
  period: QuotaPeriod;
  /** Day of month when quota resets/expires (1-31). Use last day of month if day doesn't exist. */
  expiresOn?: number;
  /** Exact ISO 8601 datetime for one-time expiration. Takes precedence over expiresOn. */
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
 *   quota: { limit: 1000, period: 'monthly' },
 *   timeout: 30,
 *   status: 'active',
 *   expiresOn: 28, // Expires on 28th of each month
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
}
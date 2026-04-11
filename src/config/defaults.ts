/**
 * Default configuration values.
 */

import type { ServerConfig, PathsConfig, QuotaSyncConfig } from './schema';

/**
 * Default server configuration.
 */
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 8080,
  host: '0.0.0.0',
  logLevel: 'info',
};

/**
 * Default paths configuration.
 */
export const DEFAULT_PATHS_CONFIG: PathsConfig = {
  configPath: './config.yaml',
  quotaStatePath: './quota-state.json',
};

/**
 * Default quota synchronization configuration.
 */
export const DEFAULT_QUOTA_SYNC_CONFIG: QuotaSyncConfig = {
  syncIntervalMs: 60000, // 60 seconds
};

/**
 * Default request timeout in seconds.
 */
export const DEFAULT_REQUEST_TIMEOUT_SEC = 300; // 300 seconds (5 minutes)

/**
 * Minimum request timeout in seconds.
 */
export const MIN_REQUEST_TIMEOUT_SEC = 1;

/**
 * Default HTTP status messages.
 */
export const HTTP_STATUS_MESSAGES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * Default user agent for upstream requests.
 */
export const DEFAULT_USER_AGENT = 'coding-plan-gateway/1.0';

/**
 * Circuit breaker defaults.
 */
export const CIRCUIT_BREAKER_DEFAULTS = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 60 seconds
  halfOpenMaxCalls: 3,
};

/**
 * Retry configuration defaults.
 */
export const RETRY_DEFAULTS = {
  maxRetries: 2,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * API version for responses.
 */
export const API_VERSION = '1.0.0';

/**
 * Latest supported configuration format version.
 * Increment this when the config schema changes.
 */
export const LATEST_CONFIG_VERSION = 1;

/**
 * @deprecated Use LATEST_CONFIG_VERSION instead. Kept for backward compat.
 */
export const CONFIG_VERSION = String(LATEST_CONFIG_VERSION);

/**
 * API key prefix for Coding Plan Gateway keys.
 */
export const API_KEY_PREFIX = 'cpg_';

/**
 * API key random portion length (characters after prefix).
 */
export const API_KEY_RANDOM_LENGTH = 32;

/**
 * Bcrypt cost factor for API key hashing.
 */
export const BCRYPT_COST_FACTOR = 12;

/**
 * Default auth configuration.
 */
export const DEFAULT_AUTH_CONFIG = {
  apiKeysPath: './api-keys.json',
  usageDataPath: './usage-data.json',
  authExemptPaths: '/health,/ready,/api/internal/*,/api/admin/quota/*/sync,/api/v1/models',
  usageSyncIntervalMs: 60000, // 60 seconds
};

/**
 * Default gateway URL for CLI notifications.
 */
export const DEFAULT_GATEWAY_URL = 'http://localhost:8080';

/**
 * Plan usage tracking configuration defaults.
 */
export const PLAN_USAGE_DEFAULTS = {
  planUsageDataPath: './data/plan-usage-data.json',
  adjustmentHistoryPath: './data/usage-adjustment-history.json',
  syncIntervalMs: 60000, // 60 seconds
  retentionDays: 90,
};

/**
 * Plan usage environment variable names.
 */
export const PLAN_USAGE_ENV_VARS = {
  PLAN_USAGE_DATA_PATH: 'PLAN_USAGE_DATA_PATH',
  ADJUSTMENT_HISTORY_PATH: 'ADJUSTMENT_HISTORY_PATH',
} as const;

/**
 * Loads plan usage configuration from environment variables.
 * Falls back to defaults for missing values.
 */
export function loadPlanUsageConfig(): { planUsageDataPath: string; adjustmentHistoryPath: string } {
  return {
    planUsageDataPath: process.env[PLAN_USAGE_ENV_VARS.PLAN_USAGE_DATA_PATH] ?? PLAN_USAGE_DEFAULTS.planUsageDataPath,
    adjustmentHistoryPath: process.env[PLAN_USAGE_ENV_VARS.ADJUSTMENT_HISTORY_PATH] ?? PLAN_USAGE_DEFAULTS.adjustmentHistoryPath,
  };
}
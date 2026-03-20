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
 * Default request timeout in milliseconds.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Minimum request timeout in milliseconds.
 */
export const MIN_REQUEST_TIMEOUT_MS = 1000;

/**
 * Maximum request timeout in milliseconds.
 */
export const MAX_REQUEST_TIMEOUT_MS = 300000; // 5 minutes

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
 * Configuration file format version.
 */
export const CONFIG_VERSION = '1.0';
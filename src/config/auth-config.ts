/**
 * Authentication configuration loader.
 * Parses environment variables for API key authentication settings.
 */

import {
  DEFAULT_AUTH_CONFIG,
} from './defaults';
import type { AuthConfig } from './schema';

/**
 * Auth environment variable names.
 */
const ENV_VARS = {
  API_KEYS_PATH: 'API_KEYS_PATH',
  USAGE_DATA_PATH: 'USAGE_DATA_PATH',
  AUTH_EXEMPT_PATHS: 'AUTH_EXEMPT_PATHS',
  USAGE_SYNC_INTERVAL_MS: 'USAGE_SYNC_INTERVAL_MS',
} as const;

/**
 * Parses a positive integer from an environment variable.
 * Returns the default value if the variable is not set or invalid.
 *
 * @param value - The environment variable value
 * @param defaultValue - The default value to use if parsing fails
 * @returns The parsed integer or default value
 */
function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

/**
 * Loads authentication configuration from environment variables.
 * Falls back to defaults for missing values.
 *
 * @returns The authentication configuration
 *
 * @example
 * ```typescript
 * // With environment variables set:
 * // API_KEYS_PATH=/data/keys.json
 * // USAGE_DATA_PATH=/data/usage.json
 * // AUTH_EXEMPT_PATHS=/health,/ready,/metrics
 * // USAGE_SYNC_INTERVAL_MS=30000
 *
 * const config = loadAuthConfig();
 * // Returns:
 * // {
 * //   apiKeysPath: '/data/keys.json',
 * //   usageDataPath: '/data/usage.json',
 * //   authExemptPaths: '/health,/ready,/metrics',
 * //   usageSyncIntervalMs: 30000
 * // }
 * ```
 */
export function loadAuthConfig(): AuthConfig {
  return {
    apiKeysPath: process.env[ENV_VARS.API_KEYS_PATH] ?? DEFAULT_AUTH_CONFIG.apiKeysPath,
    usageDataPath: process.env[ENV_VARS.USAGE_DATA_PATH] ?? DEFAULT_AUTH_CONFIG.usageDataPath,
    authExemptPaths: process.env[ENV_VARS.AUTH_EXEMPT_PATHS] ?? DEFAULT_AUTH_CONFIG.authExemptPaths,
    usageSyncIntervalMs: parsePositiveInt(
      process.env[ENV_VARS.USAGE_SYNC_INTERVAL_MS],
      DEFAULT_AUTH_CONFIG.usageSyncIntervalMs
    ),
  };
}

/**
 * Parses the auth exempt paths string into an array of paths.
 *
 * @param exemptPaths - Comma-separated list of paths (e.g., "/health,/ready")
 * @returns Array of path strings
 */
export function parseExemptPaths(exemptPaths: string): string[] {
  return exemptPaths
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

/**
 * Checks if a given path is exempt from authentication.
 *
 * @param path - The request path to check
 * @param exemptPaths - Array of exempt path patterns
 * @returns True if the path is exempt, false otherwise
 */
export function isExemptPath(path: string, exemptPaths: string[]): boolean {
  return exemptPaths.some((exemptPath) => {
    // Exact match
    if (path === exemptPath) {
      return true;
    }

    // Prefix match for paths ending with *
    if (exemptPath.endsWith('*')) {
      const prefix = exemptPath.slice(0, -1);
      return path.startsWith(prefix);
    }

    // Suffix match for paths starting with * (e.g., "*/sync" matches "/api/quota/1/sync")
    if (exemptPath.startsWith('*')) {
      const suffix = exemptPath.slice(1);
      return path.endsWith(suffix);
    }

    return false;
  });
}

/**
 * Creates a default auth configuration.
 * Useful for testing or when no customization is needed.
 *
 * @returns Default authentication configuration
 */
export function createDefaultAuthConfig(): AuthConfig {
  return { ...DEFAULT_AUTH_CONFIG };
}
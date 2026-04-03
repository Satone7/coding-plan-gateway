/**
 * Configuration loader with environment variable expansion.
 * Loads and validates configuration from YAML/JSON files.
 */

import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, extname } from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { configSchema, planConfigSchema, type PlanConfig, type Config } from './schema';
import { encryptApiKey } from './encryption';
import { DEFAULT_REQUEST_TIMEOUT_SEC, CONFIG_VERSION } from './defaults';
import { logger } from '@/utils/logger';

/**
 * Environment variable pattern for expansion.
 * Matches ${VAR_NAME} or ${VAR_NAME:-default} patterns.
 */
const ENV_VAR_PATTERN = /\$\{([^}:]+)(?::-([^}]*))?\}/g;

/**
 * Check if yaml package is available (it's listed as needed but not in package.json).
 * We'll use a simple approach: parse YAML as JSON if yaml not available,
 * or we need to add yaml to package.json.
 */

/**
 * Expand environment variables in a string.
 *
 * @param value - The string to expand
 * @returns The string with environment variables expanded
 */
function expandEnvVars(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_, varName: string, defaultValue?: string) => {
    const envValue = process.env[varName];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    logger.warn(`Environment variable ${varName} not set and no default provided`);
    return '';
  });
}

/**
 * Recursively expand environment variables in an object.
 */
function expandEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return obj.map((item) => expandEnvVarsInObject(item)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse configuration file content based on extension.
 *
 * @param content - The file content
 * @param filePath - The file path (to determine format)
 * @returns The parsed configuration object
 */
function parseConfigContent(content: string, filePath: string): unknown {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') {
    // For YAML, we need to handle it properly
    // Since yaml package might not be installed, we'll use JSON as fallback
    try {
      // Try to parse as YAML using yaml package if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yaml = require('yaml') as { parse: (content: string) => unknown };
      return yaml.parse(content);
    } catch {
      // If yaml package not available, try JSON
      try {
        return JSON.parse(content);
      } catch {
        throw new Error(
          `Failed to parse ${filePath}. Install 'yaml' package for YAML support or use JSON format.`
        );
      }
    }
  }

  if (ext === '.json') {
    return JSON.parse(content);
  }

  // Try JSON first, then YAML
  try {
    return JSON.parse(content);
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yaml = require('yaml') as { parse: (content: string) => unknown };
      return yaml.parse(content);
    } catch {
      throw new Error(`Failed to parse configuration file: ${filePath}`);
    }
  }
}

/**
 * Normalize plan configuration with defaults.
 */
function normalizePlanConfig(plan: PlanConfig): PlanConfig {
  return {
    ...plan,
    id: plan.id ?? uuidv4(),
    timeout: plan.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
    status: plan.status ?? 'active',
    enable: plan.enable ?? true,
  };
}

/**
 * Load configuration from a file.
 *
 * @param configPath - Path to the configuration file
 * @param encryptionKey - Optional encryption key for API keys
 * @returns The validated configuration
 */
export async function loadConfig(
  configPath: string,
  encryptionKey?: string
): Promise<Config> {
  const absolutePath = resolve(configPath);

  if (!(await fileExists(absolutePath))) {
    logger.warn(`Configuration file not found: ${absolutePath}, using empty configuration`);
    return { version: CONFIG_VERSION, plans: [] };
  }

  logger.info(`Loading configuration from ${absolutePath}`);

  const content = await readFile(absolutePath, 'utf-8');
  const md5Hash = createHash('md5').update(content).digest('hex');
  logger.info('Configuration file loaded', {
    path: absolutePath,
    md5: md5Hash,
    size: content.length,
  });

  const parsed = parseConfigContent(content, absolutePath);

  // Expand environment variables
  const expanded = expandEnvVarsInObject(parsed);

  // Validate configuration
  const result = configSchema.safeParse(expanded);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid configuration:\n${errors.join('\n')}`);
  }

  let config = result.data;

  // Normalize plan configurations
  config = {
    ...config,
    version: config.version ?? CONFIG_VERSION,
    plans: config.plans.map(normalizePlanConfig),
  };

  // Encrypt API keys if encryption key provided
  if (encryptionKey) {
    for (const plan of config.plans) {
      // Check if API key is not already encrypted (has 'enc:' prefix)
      if (!plan.apiKey.startsWith('enc:')) {
        plan.apiKey = encryptApiKey(plan.apiKey, encryptionKey);
      }
    }
  }

  logger.info(`Loaded ${config.plans.length} plan(s) from configuration`);

  return config;
}

/**
 * Save configuration to a file.
 *
 * @param configPath - Path to save the configuration
 * @param config - The configuration to save
 * @param format - Output format ('yaml' or 'json')
 */
export async function saveConfig(
  configPath: string,
  config: Config,
  format: 'yaml' | 'json' = 'yaml'
): Promise<void> {
  const absolutePath = resolve(configPath);

  let content: string;
  if (format === 'yaml') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yaml = require('yaml') as { stringify: (data: unknown) => string };
      content = yaml.stringify(config);
    } catch {
      // Fallback to JSON
      content = JSON.stringify(config, null, 2);
    }
  } else {
    content = JSON.stringify(config, null, 2);
  }

  const { writeFile } = await import('fs/promises');
  await writeFile(absolutePath, content, 'utf-8');

  logger.info(`Saved configuration to ${absolutePath}`);
}

/**
 * Validate a plan configuration.
 */
export function validatePlanConfig(data: unknown): PlanConfig {
  const result = planConfigSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid plan configuration:\n${errors.join('\n')}`);
  }

  return normalizePlanConfig(result.data);
}

/**
 * Create an empty configuration.
 */
export function createEmptyConfig(): Config {
  return {
    version: CONFIG_VERSION,
    plans: [],
  };
}

/**
 * Re-export types and utilities.
 */
export { configSchema, planConfigSchema } from './schema';
export type { Config, PlanConfig } from './schema';
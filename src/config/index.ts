/**
 * Configuration loader with environment variable expansion.
 * Loads and validates configuration from YAML/JSON files.
 */

import { readFile, access, copyFile } from 'fs/promises';
import { constants } from 'fs';
import { resolve, extname, dirname, basename } from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { configSchema, planConfigSchema, type PlanConfig, type Config } from './schema';
import { encryptApiKey } from './encryption';
import { DEFAULT_REQUEST_TIMEOUT_SEC, CONFIG_VERSION, LATEST_CONFIG_VERSION } from './defaults';
import { getBuiltinProvider, getBuiltinProviderByBaseUrl } from './builtin-providers';
import { migrateConfigFile } from './migrations';
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
 * Backup a config file before upgrading.
 * Creates a timestamped .bak file, preferring /app/data in production.
 */
async function backupConfigFile(configPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = basename(configPath);
  let backupDir = dirname(configPath);

  // Prefer /app/data for backups in production Docker container
  if (process.env.NODE_ENV === 'production') {
    try {
      await access('/app/data');
      backupDir = '/app/data';
    } catch {
      // Ignore if /app/data doesn't exist, use dirname(configPath)
    }
  }

  const backupPath = `${backupDir}/${fileName}.${timestamp}.bak`;
  await copyFile(configPath, backupPath);
  return backupPath;
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
 * Normalized plan configuration where baseUrl, models, and quota are guaranteed.
 * After normalization, these fields are always present — either from user input
 * or from provider preset defaults.
 */
export type NormalizedPlanConfig = PlanConfig & Required<Pick<PlanConfig, 'baseUrl' | 'models' | 'quota'>>;

/**
 * Configuration with all plans normalized (baseUrl, models, quota guaranteed).
 */
export type NormalizedConfig = Omit<Config, 'plans'> & { plans: NormalizedPlanConfig[] };

/**
 * Normalize plan configuration with defaults.
 * When a plan has a `provider`, fills in baseUrl/models/quota/modelAliases from preset.
 */
export function normalizePlanConfig(plan: PlanConfig): NormalizedPlanConfig {
  let normalized: PlanConfig = {
    ...plan,
    id: plan.id ?? uuidv4(),
    timeout: plan.timeout ?? DEFAULT_REQUEST_TIMEOUT_SEC,
    status: plan.status ?? 'active',
    enable: plan.enable ?? true,
  };

  // Apply provider preset defaults
  if (plan.provider) {
    const preset = getBuiltinProvider(plan.provider);
    if (preset) {
      normalized = {
        ...normalized,
        baseUrl: normalized.baseUrl ?? preset.baseUrl,
        openaiBaseUrl: normalized.openaiBaseUrl ?? preset.openaiBaseUrl,
        models: normalized.models ?? [...preset.models],
        modelAliases: normalized.modelAliases ?? preset.defaultModelAliases,
        // Propagate apiFormat from preset (default to 'anthropic' if not specified)
        apiFormat: normalized.apiFormat ?? preset.apiFormat ?? 'anthropic',
      };
    }
  }

  // Auto-detect provider from baseUrl if not explicitly set
  if (!normalized.provider && normalized.baseUrl) {
    const matched = getBuiltinProviderByBaseUrl(normalized.baseUrl);
    if (matched) {
      normalized.provider = matched.id;
    }
  }

  // Provider plans without explicit quota get an unlimited default
  if (!normalized.quota) {
    normalized = {
      ...normalized,
      quota: { limit: Number.MAX_SAFE_INTEGER, period: { type: 'total' } },
    };
  }

  // Validate user-configured modelAliases targets (not preset defaults)
  // Only validate if user explicitly set modelAliases and models are available
  if (plan.modelAliases && normalized.modelAliases && normalized.models) {
    const modelsLower = normalized.models.map((m: string) => m.toLowerCase());
    for (const [alias, target] of Object.entries(plan.modelAliases)) {
      const targetLower = target.toLowerCase();
      if (!modelsLower.includes(targetLower)) {
        logger.warn('Model alias target not found in plan models', {
          planId: normalized.id,
          planName: normalized.name,
          alias,
          target,
          availableModels: normalized.models,
        });
        // Remove invalid alias to prevent routing errors
        delete normalized.modelAliases![alias];
      }
    }
  }

  return normalized as NormalizedPlanConfig;
}

/** Compare two string arrays ignoring element order. */
function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Shallow-equal two plain string→string objects. */
function objectsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * Check whether the in-memory config has enrichment changes that should be persisted.
 * Compares raw Zod-parsed plans against normalized plans.
 */
function checkNeedsUpgrade(config: NormalizedConfig, rawPlans: PlanConfig[]): boolean {
  // Version format needs normalizing (e.g. "1.0" string → 1 number)
  if (config.version !== LATEST_CONFIG_VERSION) return true;

  return config.plans.some((plan, i) => {
    const raw = rawPlans[i];
    if (!raw) return false;

    // Provider was auto-detected (not in raw config)
    if (plan.provider && !raw.provider) return true;

    // Provider present but config has redundant preset-duplicated fields
    if (plan.provider) {
      const preset = getBuiltinProvider(plan.provider);
      if (!preset) return false;

      // baseUrl matching preset should be removed
      if (raw.baseUrl === preset.baseUrl) return true;
      // models should be removed (user accepts preset models)
      if (raw.models) return true;
      // quota for usage-API providers should be removed
      if (preset.hasUsageApi && raw.quota) return true;
    }

    return false;
  });
}

/**
 * Produce a clean config suitable for persisting to disk.
 * For plans with a matching preset, removes redundant fields (baseUrl, models, quota for
 * usage-API providers, modelAliases if matching defaults) and normalizes the version.
 */
function cleanConfigForPersist(config: NormalizedConfig, rawPlans: PlanConfig[]): Config {
  const cleanedPlans: PlanConfig[] = config.plans.map((plan, i) => {
    const raw = rawPlans[i];
    const preset = plan.provider ? getBuiltinProvider(plan.provider) : undefined;
    if (!preset || !raw?.provider) {
      // No preset match or provider just auto-detected — strip preset fields if they match
      if (plan.provider && preset) {
        return cleanPlanFields(plan, preset);
      }
      return plan as PlanConfig;
    }
    return cleanPlanFields(plan, preset);
  });
  return {
    ...config,
    version: LATEST_CONFIG_VERSION,
    plans: cleanedPlans,
  };
}

/** Strip preset-duplicated fields from a single plan. */
function cleanPlanFields(plan: NormalizedPlanConfig, preset: { baseUrl: string; models: string[]; hasUsageApi: boolean; defaultModelAliases?: Record<string, string> }): PlanConfig {
  const result: PlanConfig = {
    id: plan.id,
    name: plan.name,
    provider: plan.provider,
    apiKey: plan.apiKey,
    enable: plan.enable,
    status: plan.status,
  };

  if (plan.timeout !== undefined && plan.timeout !== DEFAULT_REQUEST_TIMEOUT_SEC) result.timeout = plan.timeout;
  if (plan.expiresOn !== undefined) result.expiresOn = plan.expiresOn;
  if (plan.expiresAt !== undefined) result.expiresAt = plan.expiresAt;
  if (plan.weight !== undefined) result.weight = plan.weight;

  // Only include baseUrl if it differs from preset (models always from preset)
  if (plan.baseUrl !== preset.baseUrl) {
    result.baseUrl = plan.baseUrl;
  }

  // Include quota unless provider has usage API (usage API manages quota externally)
  if (!preset.hasUsageApi && plan.quota) {
    result.quota = plan.quota;
  }

  // Always include modelAliases if present (user configuration should persist)
  if (plan.modelAliases) {
    result.modelAliases = plan.modelAliases;
  }

  return result;
}

/**
 * Load configuration from a file.
 *
 * @param configPath - Path to the configuration file
 * @param encryptionKey - Optional encryption key for API keys
 * @param options - Optional settings
 * @param options.autoUpgrade - If true, persist normalization enrichments back to disk
 * @returns The validated configuration
 */
export async function loadConfig(
  configPath: string,
  encryptionKey?: string,
  options?: { autoUpgrade?: boolean }
): Promise<NormalizedConfig> {
  const absolutePath = resolve(configPath);

  if (!(await fileExists(absolutePath))) {
    logger.warn(`Configuration file not found: ${absolutePath}, using empty configuration`);
    return { version: CONFIG_VERSION, plans: [] };
  }

  logger.info(`Loading configuration from ${absolutePath}`);

  const content = await readFile(absolutePath, 'utf-8');

  // Run config migration if needed (before parsing)
  const migrationResult = await migrateConfigFile(absolutePath);
  if (migrationResult.migrated) {
    logger.info('Configuration file was migrated', {
      fromVersion: migrationResult.fromVersion,
      toVersion: migrationResult.toVersion,
      backupPath: migrationResult.backupPath,
    });
  }

  // Re-read content after migration (file may have been updated)
  const finalContent = migrationResult.migrated
    ? await readFile(absolutePath, 'utf-8')
    : content;

  // Compute hash from post-migration content to ensure consistency
  const md5Hash = createHash('md5').update(finalContent).digest('hex');
  logger.info('Configuration file loaded', {
    path: absolutePath,
    md5: md5Hash,
    size: finalContent.length,
  });

  const parsed = parseConfigContent(finalContent, absolutePath);

  // Expand environment variables
  const expanded = expandEnvVarsInObject(parsed);

  // Warn about legacy modelAliases
  if (expanded && typeof expanded === 'object' && 'modelAliases' in expanded) {
    logger.warn(
      'Legacy root-level "modelAliases" found in configuration. ' +
      'Model aliases are now configured per-plan. This root-level configuration will be ignored. ' +
      'Please move these aliases to the "modelAliases" section of your respective plans.'
    );
  }

  // Validate configuration
  const result = configSchema.safeParse(expanded);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid configuration:\n${errors.join('\n')}`);
  }

  const rawPlans = result.data.plans;

  // Normalize plan configurations
  const config = {
    ...result.data,
    version: result.data.version ?? CONFIG_VERSION,
    plans: result.data.plans.map(normalizePlanConfig),
  } as NormalizedConfig;

  // Auto-upgrade: persist normalization enrichments back to disk
  if (options?.autoUpgrade) {
    if (checkNeedsUpgrade(config, rawPlans)) {
      try {
        const backupPath = await backupConfigFile(absolutePath);
        logger.info('Config backed up before upgrade', { backupPath });
        const cleanedConfig = cleanConfigForPersist(config, rawPlans);
        await saveConfig(absolutePath, cleanedConfig, 'yaml');
        logger.info('Config upgraded and persisted');
      } catch (err) {
        logger.warn('Failed to persist config upgrade, continuing with in-memory config', { error: (err as Error).message });
      }
    }
  }

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

  return config as NormalizedConfig;
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
export function validatePlanConfig(data: unknown): NormalizedPlanConfig {
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
export function createEmptyConfig(): NormalizedConfig {
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
export { MODEL_INFO, MODEL_NAME_ALIASES, getModelInfo, findModelInfo } from './model-info';
export type { ModelInfo } from './model-info';
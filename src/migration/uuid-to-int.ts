/**
 * UUID to Integer ID Migration Module.
 * One-time migration that converts UUID-based plan IDs to simple integers.
 *
 * @see spec.md User Story 3 for migration requirements
 */

import { readFile, writeFile, access, copyFile } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname, basename } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { PlanIdCounter } from '@/services/plan-id-counter';
import type { MigrationLog } from '@/types/plan-id-counter';
import { logger } from '@/utils/logger';

/**
 * UUID regex pattern for detecting UUID-based IDs.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Plan data structure from config file.
 */
interface PlanConfigData {
  id?: string | number;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  quota: { limit: number; period: string };
  timeout?: number;
  status?: string;
}

/**
 * Config file structure.
 */
interface ConfigData {
  plans: PlanConfigData[];
}

/**
 * Quota state entry.
 */
interface QuotaStateEntry {
  planId: string | number;
  used: number;
  limit: number;
  period: string;
  lastUpdated: string;
  resetAt: string | null;
}

/**
 * Migration options.
 */
export interface MigrationOptions {
  /** Path to config file (YAML or JSON) */
  configPath: string;
  /** Path to quota state file */
  quotaStatePath: string;
  /** PlanIdCounter for ID assignment */
  planIdCounter: PlanIdCounter;
  /** Path to migration log file */
  migrationLogPath: string;
}

/**
 * Migration result.
 */
export interface MigrationResult {
  /** Whether migration was performed */
  migrated: boolean;
  /** Number of plans migrated */
  planCount: number;
  /** UUID to integer mappings */
  mappings: MigrationLog['mappings'];
  /** Backup file paths */
  backups: {
    config: string | null;
    quotaState: string | null;
  };
}

/**
 * Check if migration is needed by detecting UUIDs in config.
 *
 * @param configPath - Path to config file
 * @returns true if UUIDs are detected and migration is needed
 */
export async function isMigrationNeeded(configPath: string): Promise<boolean> {
  try {
    await access(configPath, constants.R_OK);
  } catch {
    // Config file doesn't exist, no migration needed
    return false;
  }

  const content = await readFile(configPath, 'utf-8');
  const config = parseConfigContent(content);

  if (!config?.plans) {
    return false;
  }

  // Check if any plan has a UUID ID
  for (const plan of config.plans) {
    if (typeof plan.id === 'string' && isUuid(plan.id)) {
      return true;
    }
  }

  return false;
}

/**
 * Perform the UUID to integer migration.
 *
 * @param options - Migration options
 * @returns Migration result
 */
export async function performMigration(
  options: MigrationOptions
): Promise<MigrationResult> {
  const { configPath, quotaStatePath, planIdCounter, migrationLogPath } = options;

  const result: MigrationResult = {
    migrated: false,
    planCount: 0,
    mappings: [],
    backups: {
      config: null,
      quotaState: null,
    },
  };

  // Check if migration is needed
  const needsMigration = await isMigrationNeeded(configPath);
  if (!needsMigration) {
    logger.info('No UUID-based plan IDs found, migration not needed');
    return result;
  }

  logger.info('Starting UUID to integer migration...');

  // Create backups
  result.backups.config = await createBackup(configPath);
  result.backups.quotaState = await createBackup(quotaStatePath);

  // Read config file
  const configContent = await readFile(configPath, 'utf-8');
  const config = parseConfigContent(configContent);

  if (!config?.plans) {
    logger.warn('No plans found in config file');
    return result;
  }

  // Build UUID to integer mapping
  const uuidToIdMap = new Map<string, number>();

  for (const plan of config.plans) {
    if (typeof plan.id === 'string' && isUuid(plan.id)) {
      const newId = await planIdCounter.getNextId();
      uuidToIdMap.set(plan.id, newId);

      result.mappings.push({
        oldUuid: plan.id,
        newId,
        planName: plan.name,
      });

      // Update plan ID
      plan.id = newId;
      result.planCount++;
    }
  }

  // Write updated config
  const updatedContent = serializeConfigContent(config, configPath);
  await writeFile(configPath, updatedContent, 'utf-8');

  // Update quota state file if it exists
  await updateQuotaState(quotaStatePath, uuidToIdMap);

  // Write migration log
  const migrationLog: MigrationLog = {
    timestamp: new Date().toISOString(),
    version: '1.0',
    mappings: result.mappings,
  };

  const logDir = dirname(migrationLogPath);
  const { mkdir } = await import('fs/promises');
  await mkdir(logDir, { recursive: true });
  await writeFile(
    migrationLogPath,
    JSON.stringify(migrationLog, null, 2),
    'utf-8'
  );

  // Mark migration as complete
  await planIdCounter.setMigrationComplete();

  result.migrated = true;

  logger.info('Migration completed successfully', {
    planCount: result.planCount,
    migrationLogPath,
  });

  return result;
}

/**
 * Create a backup of a file.
 *
 * @param filePath - Path to the file to backup
 * @returns Path to the backup file, or null if file doesn't exist
 */
async function createBackup(filePath: string): Promise<string | null> {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    // File doesn't exist, no backup needed
    return null;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;
  await copyFile(filePath, backupPath);

  logger.debug('Created backup', { original: filePath, backup: backupPath });
  return backupPath;
}

/**
 * Parse config file content (YAML or JSON).
 */
function parseConfigContent(content: string): ConfigData | null {
  try {
    // Try JSON first
    const parsed = JSON.parse(content);
    return parsed as ConfigData;
  } catch {
    // Try YAML
    try {
      const parsed = parseYaml(content);
      return parsed as ConfigData;
    } catch {
      return null;
    }
  }
}

/**
 * Serialize config to file content.
 */
function serializeConfigContent(config: ConfigData, originalPath: string): string {
  const ext = basename(originalPath).toLowerCase();

  if (ext.endsWith('.json')) {
    return JSON.stringify(config, null, 2);
  }

  // Default to YAML
  return stringifyYaml(config);
}

/**
 * Update quota state file with new integer IDs.
 */
async function updateQuotaState(
  quotaStatePath: string,
  uuidToIdMap: Map<string, number>
): Promise<void> {
  try {
    await access(quotaStatePath, constants.R_OK);
  } catch {
    // Quota state file doesn't exist, nothing to update
    return;
  }

  const content = await readFile(quotaStatePath, 'utf-8');
  let quotaStates: QuotaStateEntry[];

  try {
    quotaStates = JSON.parse(content);
  } catch {
    logger.warn('Failed to parse quota state file, skipping update');
    return;
  }

  if (!Array.isArray(quotaStates)) {
    logger.warn('Quota state file is not an array, skipping update');
    return;
  }

  // Update plan IDs in quota states
  let updated = false;
  for (const state of quotaStates) {
    if (typeof state.planId === 'string' && isUuid(state.planId)) {
      const newId = uuidToIdMap.get(state.planId);
      if (newId !== undefined) {
        state.planId = newId;
        updated = true;
      }
    }
  }

  if (updated) {
    await writeFile(quotaStatePath, JSON.stringify(quotaStates, null, 2), 'utf-8');
    logger.debug('Updated quota state file with new integer IDs');
  }
}
import { readFile, writeFile } from 'fs/promises';
import { resolve, extname } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { logger } from '@/utils/logger';
import { detectConfigVersion } from './detect-version';
import { runMigrations, needsMigration } from './registry';
import { backupConfigFile } from './backup';
import type { MigrationResult } from './types';

function parseConfigFile(content: string, filePath: string): Record<string, unknown> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') {
    return JSON.parse(content) as Record<string, unknown>;
  }
  return parseYaml(content) as Record<string, unknown>;
}

function serializeConfig(config: Record<string, unknown>, filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') {
    return JSON.stringify(config, null, 2);
  }
  return stringifyYaml(config);
}

export async function migrateConfigFile(configPath: string): Promise<MigrationResult> {
  const absolutePath = resolve(configPath);

  const content = await readFile(absolutePath, 'utf-8');
  const rawConfig = parseConfigFile(content, absolutePath);

  const fromVersion = detectConfigVersion(rawConfig);

  if (!needsMigration(fromVersion)) {
    return {
      migrated: false,
      fromVersion,
      toVersion: fromVersion,
      backupPath: null,
    };
  }

  const backupPath = await backupConfigFile(absolutePath, fromVersion);

  let migratedConfig: Record<string, unknown>;
  try {
    migratedConfig = runMigrations(rawConfig, fromVersion);
  } catch (error) {
    throw new Error(
      `Config migration from v${fromVersion} failed: ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      `Backup at: ${backupPath}`
    );
  }

  const migratedContent = serializeConfig(migratedConfig, absolutePath);
  await writeFile(absolutePath, migratedContent, 'utf-8');

  const toVersion = detectConfigVersion(migratedConfig);

  logger.info(`Config migrated from v${fromVersion} to v${toVersion}`, {
    configPath: absolutePath,
    backupPath,
  });

  return {
    migrated: true,
    fromVersion,
    toVersion,
    backupPath,
  };
}

export type { ConfigMigration, MigrationResult } from './types';

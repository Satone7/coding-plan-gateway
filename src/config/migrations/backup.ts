import { copyFile, access } from 'fs/promises';
import { constants } from 'fs';

/**
 * Create a backup of the config file before migration.
 * File name format: config.yaml.v{version}.bak
 * If backup with same name exists, appends sequence: config.yaml.v{version}.bak.1
 *
 * @param configPath - Path to the config file
 * @param fromVersion - The version being migrated from
 * @returns Path to the created backup file
 * @throws Error if file doesn't exist or backup write fails
 */
export async function backupConfigFile(configPath: string, fromVersion: number): Promise<string> {
  // Verify source file exists
  try {
    await access(configPath, constants.R_OK);
  } catch {
    throw new Error(`Cannot backup: config file not found: ${configPath}`);
  }

  let backupPath = `${configPath}.v${fromVersion}.bak`;
  let seq = 0;

  // Find a non-existing backup path
  while (true) {
    try {
      await access(backupPath, constants.F_OK);
      seq++;
      backupPath = `${configPath}.v${fromVersion}.bak.${seq}`;
    } catch {
      break;
    }
  }

  await copyFile(configPath, backupPath);
  return backupPath;
}

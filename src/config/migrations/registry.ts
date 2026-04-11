import type { ConfigMigration } from './types';
import { LATEST_CONFIG_VERSION } from '../defaults';
import { v0ToV1Migration } from './v0-to-v1';

const migrations: ConfigMigration[] = [
  v0ToV1Migration,
];

export function runMigrations(
  rawConfig: Record<string, unknown>,
  fromVersion: number
): Record<string, unknown> {
  const applicable = migrations.filter((m) => m.version > fromVersion);

  if (applicable.length === 0) {
    return rawConfig;
  }

  let config = rawConfig;
  for (const migration of applicable) {
    config = migration.migrate(config);
  }

  return config;
}

export function getRegisteredMigrations(): ReadonlyArray<ConfigMigration> {
  return migrations;
}

export function needsMigration(fromVersion: number): boolean {
  return fromVersion < LATEST_CONFIG_VERSION;
}

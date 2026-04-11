/**
 * Type definitions for the versioned config migration system.
 */

/**
 * A single migration step that upgrades config from one version to the next.
 * Migrations operate on raw JS objects (no Zod validation).
 * Must be idempotent and have no side effects.
 */
export interface ConfigMigration {
  /** Target version number after this migration runs */
  version: number;
  /** Human-readable description for logging */
  description: string;
  /**
   * Migration function. Receives the raw config object and returns
   * the migrated config object. May mutate in place or return a new object.
   */
  migrate(config: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Result of running migrations.
 */
export interface MigrationResult {
  /** Whether any migrations were applied */
  migrated: boolean;
  /** Config version before migration */
  fromVersion: number;
  /** Config version after migration */
  toVersion: number;
  /** Path to backup file (if created) */
  backupPath: string | null;
}

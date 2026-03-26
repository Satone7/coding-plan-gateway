/**
 * Plan ID Counter types for auto-incrementing integer IDs.
 * Replaces UUID-based plan identifiers with simple integers (1, 2, 3...).
 */

/**
 * Maximum safe integer for JavaScript (2^53 - 1).
 * Used as upper bound for plan IDs.
 */
export const MAX_SAFE_PLAN_ID = Number.MAX_SAFE_INTEGER; // 9007199254740991

/**
 * PlanIdCounterState - Tracks the highest assigned plan ID.
 *
 * This interface defines the structure for persisting the ID counter state.
 * The counter ensures atomic, collision-free ID assignment.
 *
 * @example
 * ```typescript
 * const state: PlanIdCounterState = {
 *   lastAssignedId: 42,
 *   migrationComplete: true,
 *   migratedAt: '2026-03-26T10:30:00Z',
 * };
 * ```
 */
export interface PlanIdCounterState {
  /** Highest assigned plan ID (0 if no plans created yet) */
  lastAssignedId: number;

  /** Migration flag - set after UUID→int migration completes */
  migrationComplete: boolean;

  /** Migration timestamp (ISO 8601) - when UUID migration was completed */
  migratedAt?: string;
}

/**
 * MigrationLog - Records the UUID to integer mapping during migration.
 *
 * This log is created during the one-time migration from UUID-based
 * plan IDs to integer IDs. It provides an audit trail for the mapping.
 *
 * @example
 * ```typescript
 * const log: MigrationLog = {
 *   timestamp: '2026-03-26T10:30:00Z',
 *   version: '1.0',
 *   mappings: [
 *     { oldUuid: '550e8400-e29b-41d4-a716-446655440000', newId: 1, planName: 'Claude Pro' },
 *     { oldUuid: '660e8400-e29b-41d4-a716-446655440001', newId: 2, planName: 'Kimi Plan' },
 *   ],
 * };
 * ```
 */
export interface MigrationLog {
  /** When the migration was performed (ISO 8601) */
  timestamp: string;

  /** Migration log format version */
  version: string;

  /** UUID to integer mappings */
  mappings: Array<{
    /** Original UUID plan ID */
    oldUuid: string;
    /** New integer plan ID */
    newId: number;
    /** Plan name for reference */
    planName: string;
  }>;
}

/**
 * PlanIdCounterConfig - Configuration for the PlanIdCounter service.
 */
export interface PlanIdCounterConfig {
  /** Path to the counter state file */
  counterPath?: string;
  /** Path to the migration log file */
  migrationLogPath?: string;
}
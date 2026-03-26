/**
 * PlanIdCounter - Atomic integer ID generation for coding plans.
 * Replaces UUID-based identifiers with simple auto-incrementing integers.
 *
 * @see research.md Decision 4 for atomic ID assignment strategy
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import type {
  PlanIdCounterState,
  PlanIdCounterConfig,
  MigrationLog,
} from '@/types/plan-id-counter';
import { MAX_SAFE_PLAN_ID } from '@/types/plan-id-counter';
import { logger } from '@/utils/logger';

/**
 * Default counter state file path.
 */
const DEFAULT_COUNTER_PATH = './plan-id-counter.json';

/**
 * Default migration log file path.
 */
const DEFAULT_MIGRATION_LOG_PATH = './migration-log.json';

/**
 * PlanIdCounter - Manages auto-incrementing integer IDs for plans.
 *
 * Provides atomic ID generation with persistent state to ensure:
 * - No ID collisions across restarts
 * - Durable counter state
 * - Migration tracking from UUID to integers
 *
 * @example
 * ```typescript
 * const counter = new PlanIdCounter({ counterPath: './plan-id-counter.json' });
 * await counter.initialize();
 *
 * const newId = await counter.getNextId(); // Returns 1, then 2, then 3...
 * ```
 */
export class PlanIdCounter {
  private readonly counterPath: string;
  private readonly migrationLogPath: string;
  private state: PlanIdCounterState;
  private initialized: boolean = false;

  /**
   * Create a new PlanIdCounter.
   *
   * @param config - Configuration options
   */
  constructor(config: PlanIdCounterConfig = {}) {
    this.counterPath = resolve(config.counterPath ?? DEFAULT_COUNTER_PATH);
    this.migrationLogPath = resolve(
      config.migrationLogPath ?? DEFAULT_MIGRATION_LOG_PATH
    );
    this.state = {
      lastAssignedId: 0,
      migrationComplete: false,
    };
  }

  /**
   * Initialize the counter, loading persisted state.
   */
  async initialize(): Promise<void> {
    await this.loadState();
    this.initialized = true;

    logger.info('PlanIdCounter initialized', {
      lastAssignedId: this.state.lastAssignedId,
      migrationComplete: this.state.migrationComplete,
      counterPath: this.counterPath,
    });
  }

  /**
   * Get the next available plan ID.
   * Atomically increments the counter and persists the new state.
   *
   * @returns The next available plan ID
   * @throws Error if max safe integer is exceeded
   */
  async getNextId(): Promise<number> {
    this.ensureInitialized();

    // Check for overflow before incrementing
    if (this.state.lastAssignedId >= MAX_SAFE_PLAN_ID) {
      const error = new Error(
        `Maximum plan ID (${MAX_SAFE_PLAN_ID}) exceeded. Cannot assign more IDs.`
      );
      logger.error('Plan ID overflow', error, {
        lastAssignedId: this.state.lastAssignedId,
        maxSafeId: MAX_SAFE_PLAN_ID,
      });
      throw error;
    }

    // Increment and capture ID synchronously before any async yield
    // This ensures each concurrent call gets a unique ID
    const newId = ++this.state.lastAssignedId;
    await this.persist();

    logger.debug('Assigned new plan ID', {
      newId,
    });

    return newId;
  }

  /**
   * Get the current last assigned ID without incrementing.
   *
   * @returns The last assigned ID (0 if no plans created)
   */
  getLastAssignedId(): number {
    return this.state.lastAssignedId;
  }

  /**
   * Check if migration from UUID to integer IDs has been completed.
   *
   * @returns true if migration is complete
   */
  isMigrationComplete(): boolean {
    return this.state.migrationComplete;
  }

  /**
   * Mark migration as complete.
   * Called after successful UUID to integer migration.
   *
   * @param migratedAt - Timestamp of migration (defaults to now)
   */
  async setMigrationComplete(migratedAt?: string): Promise<void> {
    this.state.migrationComplete = true;
    this.state.migratedAt = migratedAt ?? new Date().toISOString();
    await this.persist();

    logger.info('Migration marked as complete', {
      migratedAt: this.state.migratedAt,
    });
  }

  /**
   * Set the counter to a specific value.
   * Used during migration to set the counter based on existing plans.
   *
   * @param value - The value to set the counter to
   */
  async setCounter(value: number): Promise<void> {
    if (value < 0) {
      throw new Error('Counter value must be non-negative');
    }
    if (value > MAX_SAFE_PLAN_ID) {
      throw new Error(`Counter value cannot exceed ${MAX_SAFE_PLAN_ID}`);
    }

    this.state.lastAssignedId = value;
    await this.persist();

    logger.debug('Counter set', { value });
  }

  /**
   * Write a migration log with UUID to integer mappings.
   *
   * @param mappings - The UUID to integer mappings
   */
  async writeMigrationLog(
    mappings: MigrationLog['mappings']
  ): Promise<string> {
    const log: MigrationLog = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      mappings,
    };

    // Ensure directory exists
    const dir = dirname(this.migrationLogPath);
    await mkdir(dir, { recursive: true });

    // Write the log
    await writeFile(
      this.migrationLogPath,
      JSON.stringify(log, null, 2),
      'utf-8'
    );

    logger.info('Migration log written', {
      path: this.migrationLogPath,
      mappingCount: mappings.length,
    });

    return this.migrationLogPath;
  }

  /**
   * Persist the current state to file.
   * Uses unique temp file names to handle concurrent writes safely.
   */
  private async persist(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.counterPath);
    await mkdir(dir, { recursive: true });

    // Write atomically via temp file with unique name to handle concurrent writes
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempPath = `${this.counterPath}.${uniqueSuffix}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.counterPath);

    logger.debug('Counter state persisted', {
      path: this.counterPath,
      lastAssignedId: this.state.lastAssignedId,
    });
  }

  /**
   * Load persisted state from file.
   */
  private async loadState(): Promise<void> {
    try {
      await access(this.counterPath, constants.R_OK);
    } catch {
      // File doesn't exist, use default state
      logger.debug('No existing counter state, starting fresh');
      return;
    }

    try {
      const content = await readFile(this.counterPath, 'utf-8');
      const data = JSON.parse(content) as PlanIdCounterState;

      // Validate loaded state
      if (
        typeof data.lastAssignedId === 'number' &&
        data.lastAssignedId >= 0 &&
        data.lastAssignedId <= MAX_SAFE_PLAN_ID
      ) {
        this.state = {
          lastAssignedId: data.lastAssignedId,
          migrationComplete: data.migrationComplete ?? false,
          migratedAt: data.migratedAt,
        };

        logger.debug('Loaded counter state from file', {
          lastAssignedId: this.state.lastAssignedId,
          migrationComplete: this.state.migrationComplete,
        });
      } else {
        logger.warn('Invalid counter state in file, using defaults', {
          loadedData: data,
        });
      }
    } catch (error) {
      logger.warn('Failed to load counter state, using defaults', {
        error: error instanceof Error ? error.message : String(error),
        path: this.counterPath,
      });
    }
  }

  /**
   * Ensure the counter has been initialized.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'PlanIdCounter has not been initialized. Call initialize() first.'
      );
    }
  }
}

/**
 * Create a new PlanIdCounter instance.
 *
 * @param config - Configuration options
 * @returns A new PlanIdCounter instance
 */
export function createPlanIdCounter(
  config?: PlanIdCounterConfig
): PlanIdCounter {
  return new PlanIdCounter(config);
}
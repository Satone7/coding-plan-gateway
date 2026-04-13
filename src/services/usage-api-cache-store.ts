/**
 * UsageApiCacheStore - Persists usage API query results for CLI access.
 * Gateway writes during periodic sync; CLI reads for plan list display.
 *
 * @module services/usage-api-cache-store
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir, rename } from 'fs/promises';
import lockfile from 'proper-lockfile';
import { PLAN_USAGE_DEFAULTS } from '@/config/defaults';
import { usageApiCacheFileSchema } from '@/types';
import type { UsageApiCacheEntry, UsageApiCacheFile } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Retrieved entry with stale status.
 */
export interface UsageApiCacheEntryWithStatus extends UsageApiCacheEntry {
  isStale: boolean;
}

/**
 * UsageApiCacheStore configuration.
 */
export interface UsageApiCacheStoreConfig {
  cachePath?: string;
}

/**
 * UsageApiCacheStore - File-based cache for usage API results.
 *
 * Keyed by planId (not provider+apiKey hash) because CLI doesn't have decrypted keys.
 * Gateway writes after each successful API query; CLI reads for plan list.
 *
 * TTL: 5 minutes (matching CachedUsageAdapter.cacheTTL)
 */
export class UsageApiCacheStore {
  private readonly cachePath: string;
  private readonly entries: Map<number, UsageApiCacheEntry> = new Map();

  constructor(config: UsageApiCacheStoreConfig = {}) {
    this.cachePath = resolve(config.cachePath ?? PLAN_USAGE_DEFAULTS.usageApiCachePath);
  }

  /**
   * Initialize by loading existing cache from file.
   * Creates empty cache file if it doesn't exist.
   */
  async initialize(): Promise<void> {
    // Check if file exists
    let fileExists = false;
    try {
      await access(this.cachePath, constants.R_OK);
      fileExists = true;
    } catch {
      // File doesn't exist
    }

    if (fileExists) {
      await this.loadFromFile();
    } else {
      // Create empty cache file
      await this.persistEmptyFile();
    }

    logger.info('UsageApiCacheStore initialized', {
      entryCount: this.entries.size,
      cachePath: this.cachePath,
    });
  }

  /**
   * Load cache for read-only access (CLI mode).
   * Same as initialize but without logging initialization.
   */
  async loadReadOnly(): Promise<void> {
    await this.loadFromFile();
  }

  /**
   * Update or create a cache entry.
   *
   * @param planId - The plan ID
   * @param entry - The entry data
   */
  updateEntry(planId: number, entry: UsageApiCacheEntry): void {
    this.entries.set(planId, entry);
  }

  /**
   * Get a cache entry with stale status.
   * Returns null if entry doesn't exist.
   *
   * @param planId - The plan ID
   * @returns Entry with stale status, or null
   */
  getEntry(planId: number): UsageApiCacheEntryWithStatus | null {
    const entry = this.entries.get(planId);
    if (!entry) {
      return null;
    }

    const isStale = Date.now() >= new Date(entry.expiresAt).getTime();
    return { ...entry, isStale };
  }

  /**
   * Get all entries as a map.
   *
   * @returns Map of planId to entry
   */
  getAllEntries(): Map<number, UsageApiCacheEntry> {
    return new Map(this.entries);
  }

  /**
   * Remove entries for plans that no longer exist in config.
   *
   * @param validPlanIds - Set of valid plan IDs
   */
  clearOrphanEntries(validPlanIds: number[]): void {
    const validSet = new Set(validPlanIds);
    for (const [planId] of this.entries) {
      if (!validSet.has(planId)) {
        this.entries.delete(planId);
        logger.debug('Removed orphan cache entry', { planId });
      }
    }
  }

  /**
   * Persist cache to file.
   * Uses file locking to prevent concurrent write conflicts.
   */
  async persist(): Promise<void> {
    const entriesRecord: Record<string, UsageApiCacheEntry> = {};

    for (const [planId, entry] of this.entries) {
      entriesRecord[String(planId)] = entry;
    }

    const data: UsageApiCacheFile = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      entries: entriesRecord,
    };

    // Ensure directory exists
    const dir = dirname(this.cachePath);
    await mkdir(dir, { recursive: true });

    // Ensure file exists for locking (proper-lockfile requires file to exist)
    try {
      await access(this.cachePath, constants.F_OK);
    } catch {
      // File doesn't exist, create empty file
      await writeFile(this.cachePath, '{}', 'utf-8');
    }

    // Use file locking to prevent concurrent writes
    const release = await lockfile.lock(this.cachePath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    try {
      // Write to temp file first, then rename for atomicity
      const tempPath = `${this.cachePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

      await rename(tempPath, this.cachePath);

      logger.debug('Usage API cache persisted', {
        path: this.cachePath,
        entryCount: this.entries.size,
      });
    } finally {
      await release();
    }
  }

  /**
   * Persist empty cache file (for initialization).
   * Uses file locking to prevent concurrent write conflicts.
   */
  private async persistEmptyFile(): Promise<void> {
    const data: UsageApiCacheFile = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      entries: {},
    };

    // Ensure directory exists
    const dir = dirname(this.cachePath);
    await mkdir(dir, { recursive: true });

    // Create file for locking
    await writeFile(this.cachePath, '{}', 'utf-8');

    // Use file locking to prevent concurrent writes
    const release = await lockfile.lock(this.cachePath, {
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000,
      },
    });

    try {
      // Write to temp file first, then rename for atomicity
      const tempPath = `${this.cachePath}.tmp`;
      await writeFile(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

      await rename(tempPath, this.cachePath);

      logger.debug('Empty usage API cache file created', {
        path: this.cachePath,
      });
    } finally {
      await release();
    }
  }

  /**
   * Load cache from file.
   * Uses file locking to prevent concurrent read/write conflicts.
   */
  private async loadFromFile(): Promise<void> {
    try {
      await access(this.cachePath, constants.R_OK);
    } catch {
      // File doesn't exist, start with empty cache
      return;
    }

    // Use file locking to prevent concurrent read/write conflicts
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockfile.lock(this.cachePath, {
        retries: {
          retries: 5,
          minTimeout: 100,
          maxTimeout: 1000,
        },
      });
    } catch (lockError) {
      // If locking fails, proceed without lock (file may not exist yet)
      logger.debug('Could not acquire lock for reading usage API cache, proceeding without lock', {
        error: lockError instanceof Error ? lockError.message : String(lockError),
      });
    }

    try {
      const content = await readFile(this.cachePath, 'utf-8');
      const data = JSON.parse(content);

      // Validate the storage format
      const parsed = usageApiCacheFileSchema.safeParse(data);
      if (!parsed.success) {
        logger.warn('Invalid usage API cache format, starting fresh', {
          errors: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        });
        return;
      }

      for (const [planIdStr, entry] of Object.entries(parsed.data.entries)) {
        const planId = parseInt(planIdStr, 10);
        if (isNaN(planId)) {
          logger.warn('Skipping invalid planId in cache', { planIdStr });
          continue;
        }
        this.entries.set(planId, entry);
      }

      logger.debug('Loaded usage API cache from file', {
        entryCount: this.entries.size,
        lastSync: parsed.data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load usage API cache, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (release) {
        await release();
      }
    }
  }

  /**
   * Get the cache file path.
   */
  getCachePath(): string {
    return this.cachePath;
  }
}

/**
 * Create a new UsageApiCacheStore instance.
 */
export function createUsageApiCacheStore(config?: UsageApiCacheStoreConfig): UsageApiCacheStore {
  return new UsageApiCacheStore(config);
}
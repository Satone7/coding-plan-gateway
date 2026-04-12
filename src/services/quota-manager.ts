/**
 * QuotaManager - Tracks and persists quota usage across coding plans.
 * Implements quota-based load balancing with periodic persistence.
 */

import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import type { QuotaState, QuotaPeriod } from '@/types';
import { createInitialQuotaState, calculateResetAt } from '@/types';
import { logger } from '@/utils/logger';
import { DEFAULT_QUOTA_SYNC_CONFIG } from '@/config/defaults';
import { ensureStructuredPeriod } from '@/utils/quota-period-migration';
import type { PlanUsageTracker } from './plan-usage-tracker';
import type { ProviderRegistry } from './provider-registry';

/**
 * QuotaManager configuration.
 */
export interface QuotaManagerConfig {
  /** Path to quota state file */
  quotaStatePath?: string;
  /** Interval for periodic persistence in milliseconds */
  syncIntervalMs?: number;
}

/**
 * Persisted quota state file format.
 */
interface QuotaStateFile {
  version: string;
  lastSync: string;
  states: Record<string, QuotaStateSerialized>;
}

/**
 * Serialized quota state (dates as strings).
 */
interface QuotaStateSerialized {
  planId: number;
  used: number;
  limit: number;
  period: QuotaPeriod;
  lastUpdated: string;
  resetAt: string | null;
}

/**
 * Minimal plan info needed for quota initialization.
 * This interface allows both PlanConfig and CodingPlan to be used.
 */
interface PlanQuotaInfo {
  id?: number;
  quota: {
    limit: number;
    period: QuotaPeriod;
  };
}

/**
 * QuotaManager - Manages quota tracking and persistence.
 *
 * @example
 * ```typescript
 * const manager = createQuotaManager({ quotaStatePath: './quota-state.json' });
 * await manager.initialize(plans);
 *
 * if (manager.hasRemainingQuota(planId)) {
 *   await manager.consumeQuota(planId, 1);
 * }
 * ```
 */
export class QuotaManager {
  private readonly quotaStatePath: string;
  private readonly syncIntervalMs: number;
  private readonly quotaStates: Map<number, QuotaState> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private initialized: boolean = false;
  private planUsageTracker: PlanUsageTracker | null = null;
  private readonly providerRegistry: ProviderRegistry | null;

  /**
   * Create a new QuotaManager.
   *
   * @param config - Configuration options
   */
  constructor(config: QuotaManagerConfig & { providerRegistry?: ProviderRegistry } = {}) {
    this.quotaStatePath = resolve(config.quotaStatePath ?? './quota-state.json');
    this.syncIntervalMs = config.syncIntervalMs ?? DEFAULT_QUOTA_SYNC_CONFIG.syncIntervalMs;
    this.providerRegistry = config.providerRegistry ?? null;
  }

  /**
   * Set the plan usage tracker for daily tracking integration.
   *
   * @param tracker - The PlanUsageTracker instance
   */
  setPlanUsageTracker(tracker: PlanUsageTracker): void {
    this.planUsageTracker = tracker;
    logger.debug('PlanUsageTracker attached to QuotaManager');
  }

  /**
   * Initialize quota states from plans and load persisted state.
   *
   * @param plans - All available coding plans (or plan configs)
   */
  async initialize(plans: PlanQuotaInfo[]): Promise<void> {
    // Load persisted state
    const persistedStates = await this.loadPersistedState();

    // Initialize states for all plans
    for (const plan of plans) {
      // Skip plans without an id
      if (!plan.id) {
        continue;
      }

      if (persistedStates.has(plan.id)) {
        // Use persisted state but update limit from plan config
        const persisted = persistedStates.get(plan.id)!;
        this.quotaStates.set(plan.id, {
          ...persisted,
          limit: plan.quota.limit, // Always use latest limit from config
        });
      } else {
        // Create new initial state
        const state = createInitialQuotaState(
          plan.id,
          plan.quota.limit,
          plan.quota.period
        );
        this.quotaStates.set(plan.id, state);
      }
    }

    // Check for quota resets (daily/monthly)
    this.checkQuotaResets();

    this.initialized = true;
    logger.info('QuotaManager initialized', {
      planCount: plans.length,
      statePath: this.quotaStatePath,
    });
  }

  /**
   * Get quota state for a plan.
   *
   * @param planId - The plan identifier
   * @returns Quota state or undefined
   */
  getQuotaState(planId: number): QuotaState | undefined {
    return this.quotaStates.get(planId);
  }

  /**
   * Get all quota states.
   *
   * @returns Map of plan ID to quota state
   */
  getAllQuotaStates(): Map<number, QuotaState> {
    return new Map(this.quotaStates);
  }

  /**
   * Check if a plan has remaining quota.
   * If PlanUsageTracker is attached, uses it as the source of truth.
   *
   * @param planId - The plan identifier
   * @returns true if quota remains
   */
  hasRemainingQuota(planId: number): boolean {
    // Use tracker as source of truth if attached
    if (this.planUsageTracker) {
      const usageData = this.planUsageTracker.getUsageForQuotaManager(planId);
      const used = usageData?.used ?? 0;
      const state = this.quotaStates.get(planId);
      if (!state) {
        return false;
      }
      return used < state.limit;
    }

    // Fall back to local state
    const state = this.quotaStates.get(planId);
    if (!state) {
      return false;
    }
    return state.used < state.limit;
  }

  /**
   * Async version of hasRemainingQuota that can query usage APIs.
   * For plans with a usage-API-enabled provider, queries the adapter.
   * Falls back to synchronous local state for other plans.
   */
  async hasRemainingQuotaAsync(
    planId: number,
    decryptedApiKey?: string,
    provider?: string
  ): Promise<boolean> {
    if (provider && this.providerRegistry?.hasUsageApi(provider)) {
      const adapter = this.providerRegistry.getUsageAdapter(provider);
      if (adapter && decryptedApiKey) {
        try {
          const usage = await adapter.queryUsage(decryptedApiKey);
          logger.debug('Usage API quota check', {
            planId,
            provider,
            percentage: usage.percentage,
          });
          return usage.percentage < 100;
        } catch (error) {
          logger.warn('Usage API query failed, treating as quota available', {
            planId,
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
    }
    return this.hasRemainingQuota(planId);
  }

  /**
   * Get remaining quota for a plan.
   *
   * @param planId - The plan identifier
   * @returns Remaining quota (0 if no state)
   */
  getRemainingQuota(planId: number): number {
    const state = this.quotaStates.get(planId);
    if (!state) {
      return 0;
    }
    return Math.max(0, state.limit - state.used);
  }

  /**
   * Get current used quota for a plan.
   * If PlanUsageTracker is attached, queries it as the single source of truth.
   * Otherwise, falls back to local quota state.
   *
   * @param planId - The plan identifier
   * @returns Used quota (0 if no state)
   */
  getUsedQuota(planId: number): number {
    // Prefer PlanUsageTracker as the single source of truth
    if (this.planUsageTracker) {
      const usageData = this.planUsageTracker.getUsageForQuotaManager(planId);
      return usageData?.used ?? 0;
    }

    // Fall back to local state if no tracker attached
    const state = this.quotaStates.get(planId);
    if (!state) {
      return 0;
    }
    return state.used;
  }

  /**
   * Set used quota to a specific value.
   * Used for syncing usage from PlanUsageTracker after manual adjustments.
   *
   * @param planId - The plan identifier
   * @param value - The new usage value
   * @returns true if successful, false if plan not found
   */
  setUsedQuota(planId: number, value: number): boolean {
    const state = this.quotaStates.get(planId);
    if (!state) {
      return false;
    }

    // Clamp to non-negative
    state.used = Math.max(0, value);
    state.lastUpdated = new Date();

    logger.info('Quota manually set', {
      planId,
      newValue: state.used,
      limit: state.limit,
      remaining: state.limit - state.used,
    });

    return true;
  }

  /**
   * Consume quota for a plan.
   *
   * @param planId - The plan identifier
   * @param amount - Amount to consume
   * @returns true if consumption succeeded, false if would exceed limit
   */
  consumeQuota(planId: number, amount: number = 1): boolean {
    const state = this.quotaStates.get(planId);
    if (!state) {
      return false;
    }

    if (state.used + amount > state.limit) {
      logger.warn('Quota consumption would exceed limit', {
        planId,
        current: state.used,
        amount,
        limit: state.limit,
      });
      return false;
    }

    state.used += amount;
    state.lastUpdated = new Date();

    // Track daily usage if tracker is attached
    if (this.planUsageTracker) {
      this.planUsageTracker.incrementDailyUsage(planId, amount);
    }

    logger.debug('Quota consumed', {
      planId,
      amount,
      used: state.used,
      limit: state.limit,
      remaining: state.limit - state.used,
    });

    return true;
  }

  /**
   * Refund quota for a plan (e.g., on request failure).
   *
   * @param planId - The plan identifier
   * @param amount - Amount to refund
   */
  refundQuota(planId: number, amount: number = 1): void {
    const state = this.quotaStates.get(planId);
    if (!state) {
      return;
    }

    state.used = Math.max(0, state.used - amount);
    state.lastUpdated = new Date();

    // Track daily usage refund if tracker is attached
    if (this.planUsageTracker) {
      this.planUsageTracker.decrementDailyUsage(planId, amount);
    }

    logger.debug('Quota refunded', {
      planId,
      amount,
      used: state.used,
    });
  }

  /**
   * Reset quota for a plan.
   *
   * @param planId - The plan identifier
   */
  resetQuota(planId: number): void {
    const state = this.quotaStates.get(planId);
    if (!state) {
      return;
    }

    state.used = 0;
    state.lastUpdated = new Date();
    state.resetAt = calculateResetAt(state.period, state.resetAt);

    logger.info('Quota reset', { planId });
  }

  /**
   * Update quota limit for a plan (when config changes).
   *
   * @param planId - The plan identifier
   * @param newLimit - New quota limit
   */
  updatePlanQuota(planId: number, newLimit: number): void {
    const state = this.quotaStates.get(planId);
    if (state) {
      state.limit = newLimit;
      state.lastUpdated = new Date();
    }
  }

  /**
   * Remove quota state for a deleted plan.
   *
   * @param planId - The plan identifier
   */
  removePlan(planId: number): void {
    this.quotaStates.delete(planId);
    logger.info('Quota state removed for plan', { planId });
  }

  /**
   * Start periodic quota persistence.
   */
  startPeriodicSync(): void {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = setInterval(() => {
      this.persist().catch((error) => {
        logger.error('Periodic quota sync failed', error as Error);
      });
    }, this.syncIntervalMs);

    logger.info('Periodic quota sync started', {
      intervalMs: this.syncIntervalMs,
    });
  }

  /**
   * Stop periodic quota persistence.
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('Periodic quota sync stopped');
    }
  }

  /**
   * Persist quota state to file.
   */
  async persist(): Promise<void> {
    const states: Record<string, QuotaStateSerialized> = {};

    for (const [planId, state] of this.quotaStates) {
      // Use string key for JSON serialization
      states[String(planId)] = {
        planId: state.planId,
        used: state.used,
        limit: state.limit,
        period: state.period,
        lastUpdated: state.lastUpdated.toISOString(),
        resetAt: state.resetAt ? state.resetAt.toISOString() : null,
      };
    }

    const data: QuotaStateFile = {
      version: '1.0',
      lastSync: new Date().toISOString(),
      states,
    };

    // Ensure directory exists
    const dir = dirname(this.quotaStatePath);
    await mkdir(dir, { recursive: true });

    // Write to temp file first, then rename for atomicity
    const tempPath = `${this.quotaStatePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');

    // Rename for atomic write
    const { rename } = await import('fs/promises');
    await rename(tempPath, this.quotaStatePath);

    logger.debug('Quota state persisted', {
      path: this.quotaStatePath,
      planCount: Object.keys(states).length,
    });
  }

  /**
   * Graceful shutdown - persist and stop sync.
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicSync();
    await this.persist();
    logger.info('QuotaManager shutdown complete');
  }

  /**
   * Load persisted state from file.
   */
  private async loadPersistedState(): Promise<Map<number, QuotaState>> {
    const states = new Map<number, QuotaState>();

    try {
      await access(this.quotaStatePath, constants.R_OK);
    } catch {
      // File doesn't exist, return empty map
      return states;
    }

    try {
      const content = await readFile(this.quotaStatePath, 'utf-8');
      const data = JSON.parse(content) as QuotaStateFile;

      for (const [planIdStr, serialized] of Object.entries(data.states)) {
        // Convert string key back to number
        const planId = parseInt(planIdStr, 10);
        if (isNaN(planId)) {
          logger.warn('Skipping invalid planId in quota state', { planIdStr });
          continue;
        }

        // Migrate legacy string-format periods to structured union
        const period = ensureStructuredPeriod(serialized.period);

        states.set(planId, {
          planId: serialized.planId,
          used: serialized.used,
          limit: serialized.limit,
          period,
          lastUpdated: new Date(serialized.lastUpdated),
          resetAt: serialized.resetAt ? new Date(serialized.resetAt) : null,
        });
      }

      logger.debug('Loaded persisted quota states', {
        planCount: states.size,
        lastSync: data.lastSync,
      });
    } catch (error) {
      logger.warn('Failed to load persisted quota state, starting fresh', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return states;
  }

  /**
   * Check and reset quotas that have passed their reset time.
   */
  private checkQuotaResets(): void {
    const now = new Date();

    for (const [planId, state] of this.quotaStates) {
      if (state.resetAt && now >= state.resetAt) {
        // Reset quota; pass current resetAt for sliding window recalculation
        state.used = 0;
        state.lastUpdated = now;
        state.resetAt = calculateResetAt(state.period, state.resetAt);

        logger.info('Quota auto-reset', {
          planId,
          period: state.period,
          newResetAt: state.resetAt,
        });
      }
    }
  }
}

/**
 * Create a new QuotaManager instance.
 *
 * @param config - Configuration options
 * @returns A new QuotaManager instance
 */
export function createQuotaManager(config?: QuotaManagerConfig & { providerRegistry?: ProviderRegistry }): QuotaManager {
  return new QuotaManager(config);
}
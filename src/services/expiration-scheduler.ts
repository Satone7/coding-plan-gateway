/**
 * ExpirationScheduler - Periodically checks and resets expired plan quotas.
 * Runs at regular intervals to check if any plan's expiration date has passed.
 *
 * @module services/expiration-scheduler
 */

import type { PlanUsageTracker } from './plan-usage-tracker';
import type { IPlanRepository } from './plan-repository';
import { logger } from '@/utils/logger';
import type { QuotaPeriod } from '@/types/coding-plan';

/**
 * ExpirationScheduler configuration.
 */
export interface ExpirationSchedulerConfig {
  /** Interval for checking expirations in milliseconds (default: 60000 = 1 minute) */
  checkIntervalMs?: number;
}

/**
 * ExpirationScheduler - Periodically checks and resets expired plan quotas.
 *
 * @example
 * ```typescript
 * const scheduler = createExpirationScheduler(planUsageTracker, planRepository);
 * scheduler.start();
 *
 * // On shutdown
 * scheduler.stop();
 * ```
 */
export class ExpirationScheduler {
  private readonly planUsageTracker: PlanUsageTracker;
  private readonly planRepository: IPlanRepository;
  private readonly checkIntervalMs: number;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastCheckTime: Date | null = null;

  /**
   * Create a new ExpirationScheduler.
   *
   * @param planUsageTracker - The plan usage tracker for resetting usage
   * @param planRepository - The plan repository for fetching plan configurations
   * @param config - Configuration options
   */
  constructor(
    planUsageTracker: PlanUsageTracker,
    planRepository: IPlanRepository,
    config: ExpirationSchedulerConfig = {}
  ) {
    this.planUsageTracker = planUsageTracker;
    this.planRepository = planRepository;
    this.checkIntervalMs = config.checkIntervalMs ?? 60000; // 1 minute default
  }

  /**
   * Start the periodic expiration check.
   */
  start(): void {
    if (this.checkInterval) {
      logger.warn('Expiration scheduler already running');
      return;
    }

    // Do an immediate check
    this.checkExpirations().catch((error) => {
      logger.error('Initial expiration check failed', error as Error);
    });

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkExpirations().catch((error) => {
        logger.error('Periodic expiration check failed', error as Error);
      });
    }, this.checkIntervalMs);

    logger.info('Expiration scheduler started', {
      checkIntervalMs: this.checkIntervalMs,
    });
  }

  /**
   * Stop the periodic expiration check.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Expiration scheduler stopped');
    }
  }

  /**
   * Check for expired plans and reset their usage.
   */
  private async checkExpirations(): Promise<void> {
    this.lastCheckTime = new Date();

    try {
      // Get all plans
      const plans = await this.planRepository.findAll();

      // Extract expiration config for each plan, passing structured quota config
      const plansWithExpiration = plans.map((plan) => {
        // The plan.quota.period is already a structured QuotaPeriod from the config.
        // For legacy plans still using string periods, pass them through as-is.
        const period: QuotaPeriod | 'daily' | 'monthly' | 'total' =
          typeof plan.quota.period === 'object'
            ? plan.quota.period
            : (plan.quota.period as 'daily' | 'monthly' | 'total');

        return {
          id: plan.id,
          quota: {
            period,
            // Top-level expiresOn/expiresAt for backward compat (used by legacy monthly)
            expiresOn: plan.expiresOn,
            expiresAt: plan.expiresAt,
            // resetAt is not tracked at this layer; the tracker computes from period config
            resetAt: undefined as Date | null | undefined,
          },
        };
      });

      // Check and reset expired plans
      const resetPlanIds = this.planUsageTracker.checkAndResetExpiredPlans(plansWithExpiration);

      if (resetPlanIds.length > 0) {
        logger.info('Reset expired plan quotas', {
          resetPlanIds,
          count: resetPlanIds.length,
        });

        // Persist the changes
        await this.planUsageTracker.persist();
      }
    } catch (error) {
      logger.error('Failed to check plan expirations', error as Error);
      throw error;
    }
  }

  /**
   * Get the last check time.
   */
  getLastCheckTime(): Date | null {
    return this.lastCheckTime;
  }

  /**
   * Check if the scheduler is running.
   */
  isRunning(): boolean {
    return this.checkInterval !== null;
  }
}

/**
 * Create a new ExpirationScheduler instance.
 *
 * @param planUsageTracker - The plan usage tracker for resetting usage
 * @param planRepository - The plan repository for fetching plan configurations
 * @param config - Configuration options
 * @returns A new ExpirationScheduler instance
 */
export function createExpirationScheduler(
  planUsageTracker: PlanUsageTracker,
  planRepository: IPlanRepository,
  config?: ExpirationSchedulerConfig
): ExpirationScheduler {
  return new ExpirationScheduler(planUsageTracker, planRepository, config);
}
/**
 * PlanSelector - Selects the best coding plan based on model availability and quota.
 * Implements intelligent plan selection for request routing with multiple strategies.
 *
 * @see research.md R2 for strategy pattern decision
 */

import type { CodingPlan, QuotaState } from '@/types';
import type { LoadBalanceConfig, FactorWeights, PlanScore } from '@/types/load-balancing';
import { DEFAULT_LOAD_BALANCE_CONFIG, DEFAULT_FACTOR_WEIGHTS } from '@/types/load-balancing';
import {
  calculateEffectiveExpiration,
  calculateExpirationScore,
  calculateUsageApiExpirationScore,
  calculateRpmScore,
  calculateQuotaScore,
} from '@/utils/expiration';
import { planSupportsModel } from '@/utils/model-alias';
import { logger } from '@/utils/logger';

/**
 * Options for finding plans by model.
 */
export interface FindPlansOptions {
  /** Include inactive plans (paused, error, exhausted) */
  includeInactive?: boolean;
}

/**
 * Context for plan selection strategies.
 */
export interface SelectionContext {
  /** Model being requested */
  model: string;
  /** Available plans (already filtered by model and status) */
  plans: CodingPlan[];
  /** Current quota states */
  quotaStates: Map<number, QuotaState>;
  /** RPM tracker for load awareness (optional) */
  rpmTracker?: RpmTrackerInterface;
  /** Load balancing configuration */
  config: LoadBalanceConfig;
  /** Request ID for tracing */
  requestId?: string;
  /** Usage API reset times (planId -> Unix timestamp in seconds) */
  usageResetTimes?: Map<number, number>;
  /** Usage API quota percentages (planId -> highest percentage 0-100) */
  usagePercentages?: Map<number, number>;
}

/**
 * Interface for RPM tracker (to avoid circular dependency).
 */
export interface RpmTrackerInterface {
  getRpm(planId: number): number;
}

/**
 * Strategy function type for plan selection.
 */
type StrategyFunction = (context: SelectionContext) => CodingPlan | undefined;

/**
 * Round-robin state per model.
 * Tracks the last selected plan index for each model.
 */
const roundRobinState: Map<string, number> = new Map();

/**
 * Weighted round-robin state per model.
 * Tracks the current weight counter for each plan.
 */
const weightedRoundRobinState: Map<string, Map<number, number>> = new Map();

/**
 * PlanSelector - Handles plan selection logic for request routing.
 *
 * @example
 * ```typescript
 * const selector = createPlanSelector();
 * const plan = selector.selectPlan('claude-sonnet-4-6', plans, quotaStates);
 * if (plan) {
 *   console.log(`Selected ${plan.name} for request`);
 * }
 * ```
 */
export class PlanSelector {
  private config: LoadBalanceConfig;
  private rpmTracker?: RpmTrackerInterface;

  constructor(config?: LoadBalanceConfig, rpmTracker?: RpmTrackerInterface) {
    this.config = config ?? DEFAULT_LOAD_BALANCE_CONFIG;
    this.rpmTracker = rpmTracker;
  }

  /**
   * Update the load balancing configuration.
   */
  setConfig(config: LoadBalanceConfig): void {
    this.config = config;
  }

  /**
   * Set the RPM tracker for load-aware selection.
   */
  setRpmTracker(tracker: RpmTrackerInterface): void {
    this.rpmTracker = tracker;
  }

  /**
   * Select the best plan for a given model.
   *
   * @param model - The model identifier
   * @param plans - Available plans
   * @param quotaStates - Current quota states for plans
   * @returns The selected plan, or undefined if none available
   */
  selectPlan(
    model: string,
    plans: CodingPlan[],
    quotaStates: Map<number, QuotaState>
  ): CodingPlan | undefined {
    // Find all plans that support this model
    const candidatePlans = this.findPlansByModel(model, plans);

    if (candidatePlans.length === 0) {
      logger.debug('No plans found for model', { model });
      return undefined;
    }

    // Filter to active plans only
    const activePlans = candidatePlans.filter((p) => p.status === 'active');

    if (activePlans.length === 0) {
      logger.debug('No active plans for model', { model });
      return undefined;
    }

    // Build selection context
    const context: SelectionContext = {
      model,
      plans: activePlans,
      quotaStates,
      rpmTracker: this.rpmTracker,
      config: this.config,
    };

    // Select using configured strategy
    return this.selectBestPlan(context);
  }

  /**
   * Find all plans that support a given model.
   *
   * @param model - The model identifier
   * @param plans - Available plans
   * @param options - Find options
   * @returns Plans that support the model
   */
  findPlansByModel(
    model: string,
    plans: CodingPlan[],
    options: FindPlansOptions = {}
  ): CodingPlan[] {
    const matchingPlans = plans.filter((plan) => planSupportsModel(plan, model));

    // By default, filter to active plans only
    if (!options.includeInactive) {
      return matchingPlans.filter((p) => p.status === 'active');
    }

    return matchingPlans;
  }

  /**
   * Filter plans to only include active ones.
   *
   * @param plans - Plans to filter
   * @returns Only active plans
   */
  filterActivePlans(plans: CodingPlan[]): CodingPlan[] {
    return plans.filter((plan) => plan.status === 'active' && plan.enable !== false);
  }

  /**
   * Select the best plan using the configured strategy.
   *
   * Supports two call patterns for backward compatibility:
   * - selectBestPlan(context: SelectionContext) - new API
   * - selectBestPlan(plans: CodingPlan[], quotaStates: Map<number, QuotaState>) - legacy API
   *
   * @param contextOrPlans - Selection context or plans array
   * @param quotaStates - Quota states (only used with legacy API)
   * @returns The best plan, or undefined if none available
   */
  selectBestPlan(
    contextOrPlans: SelectionContext | CodingPlan[],
    quotaStates?: Map<number, QuotaState>
  ): CodingPlan | undefined {
    // Handle legacy API: selectBestPlan(plans, quotaStates)
    let context: SelectionContext;
    if (Array.isArray(contextOrPlans)) {
      context = {
        model: '',
        plans: contextOrPlans,
        quotaStates: quotaStates ?? new Map(),
        config: this.config,
        rpmTracker: this.rpmTracker,
      };
    } else {
      context = contextOrPlans;
    }

    const { plans, config } = context;

    if (plans.length === 0) {
      return undefined;
    }

    // Filter out exhausted plans
    const availablePlans = plans.filter((plan) => {
      const state = context.quotaStates.get(plan.id);
      return !state || state.used < state.limit;
    });

    if (availablePlans.length === 0) {
      return undefined;
    }

    // Single plan - return it directly
    if (availablePlans.length === 1) {
      return availablePlans[0];
    }

    // Get strategy function and execute
    const strategy = getStrategy(config.strategy);
    return strategy({ ...context, plans: availablePlans });
  }

  /**
   * Sort plans by remaining quota in descending order.
   *
   * @param plans - Plans to sort
   * @param quotaStates - Current quota states
   * @returns Sorted plans (highest remaining first)
   */
  sortByRemainingQuota(
    plans: CodingPlan[],
    quotaStates: Map<number, QuotaState>
  ): CodingPlan[] {
    return [...plans].sort((a, b) => {
      const stateA = quotaStates.get(a.id);
      const stateB = quotaStates.get(b.id);

      const remainingA = stateA ? stateA.limit - stateA.used : a.quota.limit;
      const remainingB = stateB ? stateB.limit - stateB.used : b.quota.limit;

      // Sort descending (highest remaining first)
      return remainingB - remainingA;
    });
  }

  /**
   * Check if a plan supports a specific model.
   *
   * @param plan - The plan to check
   * @param model - The model identifier
   * @returns true if the plan supports the model
   */
  supportsModel(plan: CodingPlan, model: string): boolean {
    return planSupportsModel(plan, model);
  }

  /**
   * Check if a plan is available for use.
   *
   * @param plan - The plan to check
   * @param quotaState - Current quota state (optional)
   * @returns true if the plan is available
   */
  isPlanAvailable(plan: CodingPlan, quotaState?: QuotaState): boolean {
    // Check status
    if (plan.status !== 'active' || plan.enable === false) {
      return false;
    }

    // Check quota
    if (quotaState && quotaState.used >= quotaState.limit) {
      return false;
    }

    return true;
  }

  /**
   * Get the remaining quota for a plan.
   *
   * @param plan - The plan
   * @param quotaState - Current quota state
   * @returns Remaining quota
   */
  getRemainingQuota(plan: CodingPlan, quotaState?: QuotaState): number {
    if (!quotaState) {
      return plan.quota.limit;
    }
    return Math.max(0, quotaState.limit - quotaState.used);
  }
}

/**
 * Get the strategy function for a given strategy name.
 */
function getStrategy(strategy: string): StrategyFunction {
  const strategies: Record<string, StrategyFunction> = {
    'quota-priority': quotaPriorityStrategy,
    'round-robin': roundRobinStrategy,
    'weighted-round-robin': weightedRoundRobinStrategy,
    'random': randomStrategy,
  };

  return strategies[strategy] ?? quotaPriorityStrategy;
}

/**
 * Quota-priority strategy with multi-factor scoring.
 * Selects the plan with the highest combined score.
 */
function quotaPriorityStrategy(context: SelectionContext): CodingPlan | undefined {
  const { plans, quotaStates, rpmTracker, config, usageResetTimes, usagePercentages } = context;
  const weights = config.factorWeights ?? DEFAULT_FACTOR_WEIGHTS;

  // Calculate scores for all plans
  const scores = plans.map((plan) => calculatePlanScore(plan, quotaStates, rpmTracker, weights, usageResetTimes, usagePercentages));

  // Log score details for all candidate plans
  for (const score of scores) {
    const plan = plans.find((p) => p.id === score.planId);
    if (plan) {
      logger.debug('Candidate plan multi-factor score details', {
        requestId: context.requestId,
        planId: plan.id,
        planName: plan.name,
        totalScore: score.totalScore,
        components: score.components,
      });
    }
  }

  // Sort by total score descending
  scores.sort((a, b) => b.totalScore - a.totalScore);

  // Return the highest scoring plan
  const best = scores[0];
  if (!best) {
    return undefined;
  }

  const selectedPlan = plans.find((p) => p.id === best.planId);
  if (selectedPlan) {
    logger.debug('Selected plan with multi-factor score', {
      requestId: context.requestId,
      planId: selectedPlan.id,
      planName: selectedPlan.name,
      totalScore: best.totalScore,
      components: best.components,
    });
  }

  return selectedPlan;
}

/**
 * Round-robin strategy.
 * Cycles through plans in order for fair distribution.
 */
function roundRobinStrategy(context: SelectionContext): CodingPlan | undefined {
  const { model, plans } = context;

  if (plans.length === 0) {
    return undefined;
  }

  // Get current index for this model
  const currentIndex = roundRobinState.get(model) ?? 0;
  const nextIndex = currentIndex % plans.length;

  // Update state for next call
  roundRobinState.set(model, nextIndex + 1);

  const selectedPlan = plans[nextIndex];
  if (!selectedPlan) {
    return undefined;
  }

  logger.debug('Selected plan via round-robin', {
    requestId: context.requestId,
    model,
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    index: nextIndex,
  });

  return selectedPlan;
}

/**
 * Effective (non-negative) weight for a plan. A weight of 0 means
 * "failover-only" — the plan is excluded from primary weighted selection.
 * Missing weight defaults to 1 (equal share).
 */
function effectiveWeight(plan: CodingPlan): number {
  const weight = plan.weight ?? 1;
  return weight > 0 ? weight : 0;
}

/**
 * Weighted round-robin strategy (smooth / interleaved WRR).
 *
 * Uses the classic "current weight" algorithm: each turn adds every plan's
 * weight to a running counter, selects the plan with the highest counter, then
 * subtracts the total weight from it. This produces a smooth, proportional
 * distribution that does NOT degenerate to "first plan wins 100%" the way the
 * previous decrement-and-reset counter did.
 *
 * Weight-0 plans (failover-only) contribute 0 each turn and are therefore
 * never selected as long as any positive-weight candidate exists.
 */
function weightedRoundRobinStrategy(context: SelectionContext): CodingPlan | undefined {
  const { model, plans } = context;

  if (plans.length === 0) {
    return undefined;
  }

  // Get or initialize running-counter state for this model
  let modelState = weightedRoundRobinState.get(model);
  if (!modelState) {
    modelState = new Map();
    weightedRoundRobinState.set(model, modelState);
  }

  // Initialize counters for new plans (start at 0)
  for (const plan of plans) {
    if (!modelState.has(plan.id)) {
      modelState.set(plan.id, 0);
    }
  }

  const weightById = new Map<number, number>();
  let totalWeight = 0;
  for (const plan of plans) {
    const w = effectiveWeight(plan);
    weightById.set(plan.id, w);
    totalWeight += w;
  }

  // All candidates are weight-0 (failover-only): no weighted selection is
  // possible, so fall back to plain round-robin among them so they are at
  // least tried in turn.
  if (totalWeight <= 0) {
    const currentIndex = roundRobinState.get(model) ?? 0;
    const nextIndex = currentIndex % plans.length;
    roundRobinState.set(model, nextIndex + 1);
    return plans[nextIndex];
  }

  // Interleaved WRR: advance every counter by its weight, pick the max,
  // then subtract the total from the winner.
  let selectedPlan: CodingPlan = plans[0]!;
  let bestCounter = -Infinity;

  for (const plan of plans) {
    const weight = weightById.get(plan.id) ?? 0;
    const current = (modelState.get(plan.id) ?? 0) + weight;
    modelState.set(plan.id, current);
    if (current > bestCounter) {
      bestCounter = current;
      selectedPlan = plan;
    }
  }

  modelState.set(selectedPlan.id, bestCounter - totalWeight);

  logger.debug('Selected plan via weighted-round-robin', {
    requestId: context.requestId,
    model,
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    weight: weightById.get(selectedPlan.id) ?? 0,
    counter: bestCounter,
  });

  return selectedPlan;
}

/**
 * Random strategy.
 * Selects a plan uniformly at random.
 */
function randomStrategy(context: SelectionContext): CodingPlan | undefined {
  const { plans } = context;

  if (plans.length === 0) {
    return undefined;
  }

  const randomIndex = Math.floor(Math.random() * plans.length);
  const selectedPlan = plans[randomIndex];

  if (!selectedPlan) {
    return undefined;
  }

  logger.debug('Selected plan via random', {
    requestId: context.requestId,
    planId: selectedPlan.id,
    planName: selectedPlan.name,
    index: randomIndex,
  });

  return selectedPlan;
}

/**
 * Calculate multi-factor score for a plan.
 */
function calculatePlanScore(
  plan: CodingPlan,
  quotaStates: Map<number, QuotaState>,
  rpmTracker?: RpmTrackerInterface,
  weights: FactorWeights = DEFAULT_FACTOR_WEIGHTS,
  usageResetTimes?: Map<number, number>,
  usagePercentages?: Map<number, number>
): PlanScore {
  // Calculate expiration score with fallback to Usage API reset time
  let expiresAt = calculateEffectiveExpiration(plan);
  let expirationSource: 'config' | 'usage-api' | 'quota-state' | 'none' = 'none';

  // Source: plan config (expiresOn/expiresAt)
  if (expiresAt) {
    expirationSource = 'config';
  }

  // Fallback 1: Usage API reset time (for plans without explicit expiration config)
  if (!expiresAt && usageResetTimes) {
    const resetTimestamp = usageResetTimes.get(plan.id);
    if (resetTimestamp) {
      expiresAt = new Date(resetTimestamp); // Already in milliseconds (from Zhipu API)
      expirationSource = 'usage-api';
    }
  }

  // Fallback 2: QuotaState resetAt (for local quota plans)
  if (!expiresAt) {
    const quotaState = quotaStates.get(plan.id);
    if (quotaState?.resetAt) {
      expiresAt = quotaState.resetAt;
      expirationSource = 'quota-state';
    }
  }

  // Use different scoring based on expiration source
  // Usage API providers (like Zhipu) use aggressive weekly-based scoring
  const expirationScore = expirationSource === 'usage-api'
    ? calculateUsageApiExpirationScore(expiresAt)
    : calculateExpirationScore(expiresAt);

  // Calculate RPM score
  let rpmScore = 100; // Default to highest if no tracker
  if (rpmTracker) {
    const currentRpm = rpmTracker.getRpm(plan.id);
    // Use a reasonable max RPM for normalization (e.g., 60 requests/min)
    const maxRpm = 60;
    rpmScore = calculateRpmScore(currentRpm, maxRpm);
  }

  // Calculate quota score
  // For Usage API providers, use percentage data (remaining = 100 - used_percentage)
  let quotaScore: number;
  if (expirationSource === 'usage-api' && usagePercentages) {
    const usedPercentage = usagePercentages.get(plan.id) ?? 0;
    quotaScore = Math.round(100 - usedPercentage); // Remaining percentage
  } else {
    // Standard quota calculation from local state or plan config
    const quotaState = quotaStates.get(plan.id);
    quotaScore = quotaState
      ? calculateQuotaScore(quotaState.used, quotaState.limit)
      : calculateQuotaScore(0, plan.quota.limit);
  }

  // Calculate weighted total
  const totalScore =
    expirationScore * weights.expiration +
    rpmScore * weights.rpm +
    quotaScore * weights.quota;

  return {
    planId: plan.id,
    totalScore: Math.round(totalScore * 100) / 100, // Round to 2 decimal places
    components: {
      expiration: expirationScore,
      rpm: rpmScore,
      quota: quotaScore,
    },
  };
}

/**
 * Reset all strategy state (useful for testing).
 */
export function resetStrategyState(): void {
  roundRobinState.clear();
  weightedRoundRobinState.clear();
}

/**
 * Create a new PlanSelector instance.
 *
 * @param config - Optional load balancing configuration
 * @param rpmTracker - Optional RPM tracker for load-aware selection
 * @returns A new PlanSelector instance
 */
export function createPlanSelector(
  config?: LoadBalanceConfig,
  rpmTracker?: RpmTrackerInterface
): PlanSelector {
  return new PlanSelector(config, rpmTracker);
}
/**
 * PlanSelector - Selects the best coding plan based on model availability and quota.
 * Implements intelligent plan selection for request routing.
 */

import type { CodingPlan, QuotaState } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Options for finding plans by model.
 */
export interface FindPlansOptions {
  /** Include inactive plans (paused, error, exhausted) */
  includeInactive?: boolean;
}

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
    quotaStates: Map<string, QuotaState>
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

    // Select the best plan based on quota
    return this.selectBestPlan(activePlans, quotaStates);
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
    const normalizedModel = model.toLowerCase().trim();

    const matchingPlans = plans.filter((plan) =>
      plan.models.some((m) => m.toLowerCase() === normalizedModel)
    );

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
    return plans.filter((plan) => plan.status === 'active');
  }

  /**
   * Select the best plan from a list of candidates.
   * Uses quota-based selection - prefers plans with highest remaining quota.
   *
   * @param plans - Candidate plans (should be active)
   * @param quotaStates - Current quota states
   * @returns The best plan, or undefined if none available
   */
  selectBestPlan(
    plans: CodingPlan[],
    quotaStates: Map<string, QuotaState>
  ): CodingPlan | undefined {
    if (plans.length === 0) {
      return undefined;
    }

    // Sort by remaining quota (descending)
    const sortedPlans = this.sortByRemainingQuota(plans, quotaStates);

    // Return the plan with highest remaining quota
    // Skip plans that are exhausted
    for (const plan of sortedPlans) {
      const state = quotaStates.get(plan.id);
      if (!state || state.used < state.limit) {
        logger.debug('Selected best plan', {
          planId: plan.id,
          planName: plan.name,
          remaining: state ? state.limit - state.used : plan.quota.limit,
        });
        return plan;
      }
    }

    // All plans exhausted
    return undefined;
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
    quotaStates: Map<string, QuotaState>
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
    const normalizedModel = model.toLowerCase().trim();
    return plan.models.some((m) => m.toLowerCase() === normalizedModel);
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
    if (plan.status !== 'active') {
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
 * Create a new PlanSelector instance.
 *
 * @returns A new PlanSelector instance
 */
export function createPlanSelector(): PlanSelector {
  return new PlanSelector();
}
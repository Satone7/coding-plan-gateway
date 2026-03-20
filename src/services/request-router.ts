/**
 * RequestRouter - Routes requests to appropriate coding plans.
 * Integrates PlanSelector, CircuitBreaker, and failover logic.
 */

import { randomUUID } from 'crypto';
import type { IPlanRepository } from '@/services/plan-repository';
import { PlanSelector, createPlanSelector } from '@/services/plan-selector';
import { CircuitBreaker, createCircuitBreaker } from '@/services/circuit-breaker';
import type { CodingPlan, QuotaState, GatewayError } from '@/types';
import { createGatewayError } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Result of a routing decision.
 */
export interface RoutingResult {
  /** The selected plan for the request */
  selectedPlan: CodingPlan | undefined;
  /** Alternative plans for failover */
  alternativePlans: CodingPlan[];
  /** Request ID for tracing */
  requestId: string;
}

/**
 * Plan with decrypted API key for request execution.
 */
export interface PlanWithCredentials {
  /** The selected plan */
  plan: CodingPlan;
  /** Decrypted API key */
  apiKey: string;
}

/**
 * RequestRouter - Handles request routing with failover support.
 *
 * @example
 * ```typescript
 * const router = createRequestRouter(repository);
 *
 * const result = await router.route('claude-sonnet-4-6');
 * if (result.selectedPlan) {
 *   const { plan, apiKey } = await router.getPlanForRequest('claude-sonnet-4-6');
 *   // Forward request to plan.baseUrl with apiKey
 * }
 * ```
 */
export class RequestRouter {
  private readonly repository: IPlanRepository;
  private readonly planSelector: PlanSelector;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly quotaStates: Map<string, QuotaState>;

  /**
   * Create a new RequestRouter.
   *
   * @param repository - Plan repository for fetching plans
   */
  constructor(repository: IPlanRepository) {
    this.repository = repository;
    this.planSelector = createPlanSelector();
    this.circuitBreaker = createCircuitBreaker();
    this.quotaStates = new Map();
  }

  /**
   * Route a request to the best available plan.
   *
   * @param model - The model to route for
   * @returns Routing result with selected and alternative plans
   */
  async route(model: string): Promise<RoutingResult> {
    const requestId = randomUUID();

    // Find all plans supporting this model
    const allPlans = await this.repository.findByModel(model);
    const activePlans = this.planSelector.filterActivePlans(allPlans);

    if (activePlans.length === 0) {
      logger.warn('No active plans found for model', {
        requestId,
        model,
        totalPlans: allPlans.length,
      });

      return {
        selectedPlan: undefined,
        alternativePlans: [],
        requestId,
      };
    }

    // Filter out plans with open circuits
    const availablePlans = activePlans.filter(
      (plan) => this.circuitBreaker.canExecute(plan.id)
    );

    if (availablePlans.length === 0) {
      logger.warn('All circuits open for model', {
        requestId,
        model,
        totalPlans: activePlans.length,
        openCircuits: this.circuitBreaker.getOpenCircuitCount(),
      });

      return {
        selectedPlan: undefined,
        alternativePlans: [],
        requestId,
      };
    }

    // Select the best plan based on quota
    const selectedPlan = this.planSelector.selectBestPlan(availablePlans, this.quotaStates);

    if (!selectedPlan) {
      logger.warn('No suitable plan found after quota filtering', {
        requestId,
        model,
        availablePlans: availablePlans.length,
      });

      return {
        selectedPlan: undefined,
        alternativePlans: [],
        requestId,
      };
    }

    // Get alternative plans for failover (exclude selected)
    const alternativePlans = availablePlans.filter(
      (plan) => plan.id !== selectedPlan.id
    );

    logger.info('Request routed to plan', {
      requestId,
      model,
      selectedPlanId: selectedPlan.id,
      selectedPlanName: selectedPlan.name,
      alternativeCount: alternativePlans.length,
    });

    return {
      selectedPlan,
      alternativePlans,
      requestId,
    };
  }

  /**
   * Get a plan with credentials for executing a request.
   * Throws an error if no plan is available.
   *
   * @param model - The model to get a plan for
   * @returns Plan with decrypted API key
   * @throws GatewayError if no plan is available
   */
  async getPlanForRequest(model: string): Promise<PlanWithCredentials> {
    const result = await this.route(model);

    if (!result.selectedPlan) {
      throw createGatewayError(
        'MODEL_NOT_FOUND',
        `No coding plan supports model '${model}'`,
        { model, requestId: result.requestId }
      );
    }

    const apiKey = await this.repository.getDecryptedApiKey(result.selectedPlan.id);

    if (!apiKey) {
      throw createGatewayError(
        'INTERNAL_ERROR',
        'Failed to get API key for selected plan',
        { planId: result.selectedPlan.id, requestId: result.requestId }
      );
    }

    return {
      plan: result.selectedPlan,
      apiKey,
    };
  }

  /**
   * Mark a plan as successful (close circuit).
   *
   * @param planId - The plan identifier
   */
  markPlanSuccess(planId: string): void {
    this.circuitBreaker.recordSuccess(planId);
    logger.debug('Plan marked as successful', { planId });
  }

  /**
   * Mark a plan as failed (potentially open circuit).
   *
   * @param planId - The plan identifier
   */
  markPlanFailed(planId: string): void {
    this.circuitBreaker.recordFailure(planId);
    logger.warn('Plan marked as failed', {
      planId,
      circuitState: this.circuitBreaker.getState(planId),
    });
  }

  /**
   * Get all available plans for a model.
   *
   * @param model - The model identifier
   * @returns Available plans (active, with closed circuits)
   */
  async getAvailablePlans(model: string): Promise<CodingPlan[]> {
    const allPlans = await this.repository.findByModel(model);
    const activePlans = this.planSelector.filterActivePlans(allPlans);

    return activePlans.filter((plan) => this.circuitBreaker.canExecute(plan.id));
  }

  /**
   * Get alternative plans for failover.
   *
   * @param model - The model identifier
   * @param excludePlanId - Plan ID to exclude
   * @returns Alternative plans
   */
  async getAlternativePlans(model: string, excludePlanId: string): Promise<CodingPlan[]> {
    const availablePlans = await this.getAvailablePlans(model);
    return availablePlans.filter((plan) => plan.id !== excludePlanId);
  }

  /**
   * Update quota state for a plan.
   *
   * @param planId - The plan identifier
   * @param state - New quota state
   */
  updateQuotaState(planId: string, state: QuotaState): void {
    this.quotaStates.set(planId, state);
  }

  /**
   * Get quota state for a plan.
   *
   * @param planId - The plan identifier
   * @returns Quota state or undefined
   */
  getQuotaState(planId: string): QuotaState | undefined {
    return this.quotaStates.get(planId);
  }

  /**
   * Get the circuit breaker instance.
   *
   * @returns The circuit breaker
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Get the plan selector instance.
   *
   * @returns The plan selector
   */
  getPlanSelector(): PlanSelector {
    return this.planSelector;
  }

  /**
   * Reset all circuits and quota states.
   */
  reset(): void {
    this.circuitBreaker.resetAll();
    this.quotaStates.clear();
    logger.info('RequestRouter reset');
  }
}

/**
 * Create a new RequestRouter instance.
 *
 * @param repository - Plan repository
 * @returns A new RequestRouter instance
 */
export function createRequestRouter(repository: IPlanRepository): RequestRouter {
  return new RequestRouter(repository);
}
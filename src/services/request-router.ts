/**
 * RequestRouter - Routes requests to appropriate coding plans.
 * Integrates PlanSelector, CircuitBreaker, QuotaManager, RpmTracker, and failover logic.
 */

import { randomUUID } from 'crypto';
import type { IPlanRepository } from '@/services/plan-repository';
import { PlanSelector, createPlanSelector, type SelectionContext } from '@/services/plan-selector';
import { resolveCanonicalName } from '@/utils/model-alias';
import { CircuitBreaker, createCircuitBreaker } from '@/services/circuit-breaker';
import type { QuotaManager } from '@/services/quota-manager';
import type { ProviderRegistry } from '@/services/provider-registry';
import { RpmTracker, createRpmTracker } from '@/services/rpm-tracker';
import type { CodingPlan, QuotaState } from '@/types';
import type { LoadBalanceConfig } from '@/types/load-balancing';
import { DEFAULT_LOAD_BALANCE_CONFIG } from '@/types/load-balancing';
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
  /** The canonical name of the model */
  canonicalName?: string;
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
 * Create an empty routing result.
 */
function emptyResult(requestId: string, canonicalName?: string): RoutingResult {
  return {
    selectedPlan: undefined,
    alternativePlans: [],
    requestId,
    canonicalName,
  };
}

/**
 * RequestRouter - Handles request routing with failover support.
 */
export class RequestRouter {
  private readonly repository: IPlanRepository;
  private readonly planSelector: PlanSelector;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly quotaManager: QuotaManager | null;
  private readonly rpmTracker: RpmTracker;
  private readonly loadBalanceConfig: LoadBalanceConfig;
  private readonly providerRegistry: ProviderRegistry | null;

  /**
   * Create a new RequestRouter.
   */
  constructor(
    repository: IPlanRepository,
    quotaManager?: QuotaManager,
    loadBalanceConfig?: LoadBalanceConfig,
    providerRegistry?: ProviderRegistry
  ) {
    this.repository = repository;
    this.loadBalanceConfig = loadBalanceConfig ?? DEFAULT_LOAD_BALANCE_CONFIG;
    this.rpmTracker = createRpmTracker();
    this.planSelector = createPlanSelector(this.loadBalanceConfig, this.rpmTracker);
    this.circuitBreaker = createCircuitBreaker();
    this.quotaManager = quotaManager ?? null;
    this.providerRegistry = providerRegistry ?? null;
  }

  /**
   * Filter plans to only those with closed circuits.
   */
  private filterByCircuit(plans: CodingPlan[]): CodingPlan[] {
    return plans.filter((plan) => this.circuitBreaker.canExecute(plan.id));
  }

  /**
   * Filter plans to only those with remaining quota.
   */
  private async filterByQuota(plans: CodingPlan[]): Promise<CodingPlan[]> {
    if (!this.quotaManager) {
      return plans;
    }

    const results: CodingPlan[] = [];
    for (const plan of plans) {
      if (plan.provider && this.providerRegistry?.hasUsageApi(plan.provider)) {
        const apiKey = await this.repository.getDecryptedApiKey(plan.id);
        const hasQuota = await this.quotaManager.hasRemainingQuotaAsync(
          plan.id,
          apiKey ?? undefined,
          plan.provider
        );
        if (hasQuota) {
          results.push(plan);
        }
      } else {
        if (this.quotaManager.hasRemainingQuota(plan.id)) {
          results.push(plan);
        }
      }
    }
    return results;
  }

  /**
   * Log and return empty result for no active plans.
   */
  private handleNoActivePlans(model: string, requestId: string, totalPlans: number): RoutingResult {
    logger.warn('No active plans found for model', {
      requestId,
      model,
      totalPlans,
    });
    return emptyResult(requestId, model);
  }

  /**
   * Log and return empty result for all circuits open.
   */
  private handleAllCircuitsOpen(model: string, requestId: string, activeCount: number): RoutingResult {
    logger.warn('All circuits open for model', {
      requestId,
      model,
      totalPlans: activeCount,
      openCircuits: this.circuitBreaker.getOpenCircuitCount(),
    });
    return emptyResult(requestId, model);
  }

  /**
   * Log and return empty result for all plans exhausted.
   */
  private handleAllExhausted(model: string, requestId: string, availableCount: number): RoutingResult {
    logger.warn('All plans exhausted for model', {
      requestId,
      model,
      availablePlans: availableCount,
    });
    return emptyResult(requestId, model);
  }

  /**
   * Route a request to the best available plan.
   */
  async route(model: string, incomingRequestId?: string): Promise<RoutingResult> {
    const requestId = incomingRequestId ?? randomUUID();
    const searchModel = model;

    // Find all plans supporting this model (using canonical name for matching)
    const allPlans = await this.repository.findByModel(searchModel);
    const activePlans = this.planSelector.filterActivePlans(allPlans);

    if (activePlans.length === 0) {
      return this.handleNoActivePlans(searchModel, requestId, allPlans.length);
    }

    // Filter out plans with open circuits
    const availablePlans = this.filterByCircuit(activePlans);

    if (availablePlans.length === 0) {
      return this.handleAllCircuitsOpen(searchModel, requestId, activePlans.length);
    }

    // Filter out exhausted plans if quota manager is available
    const plansWithQuota = await this.filterByQuota(availablePlans);

    if (plansWithQuota.length === 0) {
      return this.handleAllExhausted(searchModel, requestId, availablePlans.length);
    }

    // Select the best plan based on load balancing strategy
    const quotaStates = this.quotaManager?.getAllQuotaStates() ?? new Map<number, QuotaState>();
    const context: SelectionContext = {
      model: searchModel,
      plans: plansWithQuota,
      quotaStates,
      rpmTracker: this.rpmTracker,
      config: this.loadBalanceConfig,
      requestId,
    };
    const selectedPlan = this.planSelector.selectBestPlan(context);

    if (!selectedPlan) {
      logger.warn('No suitable plan found after quota filtering', {
        requestId,
        model: searchModel,
        availablePlans: plansWithQuota.length,
      });
      return emptyResult(requestId, searchModel);
    }

    // Record the request in RPM tracker for load balancing
    this.rpmTracker.recordRequest(selectedPlan.id);

    // Determine the exact case canonical name from the selected plan
    const canonicalName = resolveCanonicalName(selectedPlan, searchModel);

    // Get alternative plans for failover (exclude selected)
    const alternativePlans = plansWithQuota.filter(
      (plan) => plan.id !== selectedPlan.id
    );

    logger.info('Request routed to plan', {
      requestId,
      model,
      selectedPlanId: selectedPlan.id,
      selectedPlanName: selectedPlan.name,
      timeout: selectedPlan.timeout,
      alternativeCount: alternativePlans.length,
    });

    return {
      selectedPlan,
      alternativePlans,
      requestId,
      canonicalName,
    };
  }

  /**
   * Get a plan with credentials for executing a request.
   * Throws an error if no plan is available.
   */
  async getPlanForRequest(model: string, incomingRequestId?: string): Promise<PlanWithCredentials> {
    const result = await this.route(model, incomingRequestId);

    if (!result.selectedPlan) {
      // Get all available models to include in error message
      const allPlans = await this.repository.findAll();
      const availableModels = [...new Set(allPlans.flatMap((p) => p.models))].sort();

      throw createGatewayError(
        'MODEL_NOT_FOUND',
        `Model '${model}' not found. Case-insensitive search performed. Available models: ${availableModels.join(', ')}`,
        {
          model,
          searchedModel: model,
          availableModels,
          requestId: result.requestId,
        }
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

    // Consume quota if quota manager is available
    if (this.quotaManager) {
      const consumed = this.quotaManager.consumeQuota(result.selectedPlan.id);
      if (!consumed) {
        throw createGatewayError(
          'QUOTA_EXHAUSTED',
          `Quota exhausted for plan '${result.selectedPlan.name}'`,
          { planId: result.selectedPlan.id, requestId: result.requestId }
        );
      }
    }

    return {
      plan: result.selectedPlan,
      apiKey,
    };
  }

  /**
   * Mark a plan as successful (close circuit).
   */
  markPlanSuccess(planId: number): void {
    this.circuitBreaker.recordSuccess(planId);
    logger.debug('Plan marked as successful', { planId });
  }

  /**
   * Mark a plan as failed (potentially open circuit).
   */
  markPlanFailed(planId: number): void {
    this.circuitBreaker.recordFailure(planId);
    logger.warn('Plan marked as failed', {
      planId,
      circuitState: this.circuitBreaker.getState(planId),
    });
  }

  /**
   * Refund quota for a failed request.
   */
  refundQuota(planId: number, amount: number = 1): void {
    if (this.quotaManager) {
      this.quotaManager.refundQuota(planId, amount);
    }
  }

  /**
   * Get all available plans for a model.
   */
  async getAvailablePlans(model: string): Promise<CodingPlan[]> {
    const allPlans = await this.repository.findByModel(model);
    const activePlans = this.planSelector.filterActivePlans(allPlans);
    const available = this.filterByCircuit(activePlans);

    // Filter by quota if quota manager is available
    return await this.filterByQuota(available);
  }

  /**
   * Get alternative plans for failover.
   */
  async getAlternativePlans(model: string, excludePlanId: number): Promise<CodingPlan[]> {
    const availablePlans = await this.getAvailablePlans(model);
    return availablePlans.filter((plan) => plan.id !== excludePlanId);
  }

  /**
   * Update quota state for a plan.
   * @deprecated Use QuotaManager directly
   */
  updateQuotaState(_planId: number, _state: QuotaState): void {
    logger.warn('updateQuotaState is deprecated, use QuotaManager directly');
  }

  /**
   * Get quota state for a plan.
   */
  getQuotaState(planId: number): QuotaState | undefined {
    return this.quotaManager?.getQuotaState(planId);
  }

  /**
   * Get the circuit breaker instance.
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Get the plan selector instance.
   */
  getPlanSelector(): PlanSelector {
    return this.planSelector;
  }

  /**
   * Get the quota manager instance.
   */
  getQuotaManager(): QuotaManager | null {
    return this.quotaManager;
  }

  /**
   * Get the RPM tracker instance.
   */
  getRpmTracker(): RpmTracker {
    return this.rpmTracker;
  }

  /**
   * Reset all circuits.
   */
  reset(): void {
    this.circuitBreaker.resetAll();
    logger.info('RequestRouter reset');
  }
}

/**
 * Create a new RequestRouter instance.
 */
export function createRequestRouter(
  repository: IPlanRepository,
  quotaManager?: QuotaManager,
  loadBalanceConfig?: LoadBalanceConfig,
  providerRegistry?: ProviderRegistry
): RequestRouter {
  return new RequestRouter(repository, quotaManager, loadBalanceConfig, providerRegistry);
}
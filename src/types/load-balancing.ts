/**
 * Load balancing types for plan selection strategies.
 * @see research.md R2 for strategy pattern decision
 * @see data-model.md for entity definitions
 */

/**
 * Available load balancing strategies.
 *
 * - quota-priority: Select plan with highest remaining quota (default, existing behavior)
 * - round-robin: Cycle through plans in order for fair distribution
 * - weighted-round-robin: Cycle proportionally to configured weights
 * - random: Uniform random selection
 */
export type LoadBalanceStrategy =
  | 'quota-priority'
  | 'round-robin'
  | 'weighted-round-robin'
  | 'random';

/**
 * Weights for multi-factor scoring in plan selection.
 * Values must sum to 1.0 for proper score calculation.
 *
 * Default weights prioritize expiration and load balancing:
 * - expiration: 0.4 (prioritize plans expiring soon)
 * - rpm: 0.4 (balance load across plans)
 * - quota: 0.2 (consider remaining capacity)
 */
export interface FactorWeights {
  /** Weight for expiration factor (0-1, default 0.4) */
  expiration: number;
  /** Weight for RPM factor (0-1, default 0.4) */
  rpm: number;
  /** Weight for quota factor (0-1, default 0.2) */
  quota: number;
}

/**
 * Load balancing configuration.
 * Controls how plans are selected for request routing.
 *
 * @example
 * ```typescript
 * const lbConfig: LoadBalanceConfig = {
 *   strategy: 'round-robin',
 *   factorWeights: {
 *     expiration: 0.4,
 *     rpm: 0.4,
 *     quota: 0.2,
 *   },
 * };
 * ```
 */
export interface LoadBalanceConfig {
  /** Selection strategy to use (default: 'quota-priority') */
  strategy: LoadBalanceStrategy;
  /** Weights for multi-factor scoring (used by quota-priority strategy) */
  factorWeights: FactorWeights;
}

/**
 * Computed score for a plan during selection.
 * Used internally by plan selector for multi-factor scoring.
 */
export interface PlanScore {
  /** Plan identifier */
  planId: number;
  /** Total computed score (0-100) */
  totalScore: number;
  /** Individual factor scores */
  components: {
    /** Expiration score (0-100, higher = expiring soon) */
    expiration: number;
    /** RPM score (0-100, higher = lower load) */
    rpm: number;
    /** Quota score (0-100, higher = more remaining) */
    quota: number;
  };
}

/**
 * Default factor weights for multi-factor scoring.
 */
export const DEFAULT_FACTOR_WEIGHTS: FactorWeights = {
  expiration: 0.4,
  rpm: 0.4,
  quota: 0.2,
};

/**
 * Default load balancing configuration.
 * Maintains backward compatibility with existing quota-priority behavior.
 */
export const DEFAULT_LOAD_BALANCE_CONFIG: LoadBalanceConfig = {
  strategy: 'quota-priority',
  factorWeights: DEFAULT_FACTOR_WEIGHTS,
};
/**
 * CircuitBreaker - Handles provider failure detection and recovery.
 * Implements the circuit breaker pattern for resilience.
 */

import { logger } from '@/utils/logger';
import {
  CIRCUIT_BREAKER_DEFAULTS,
} from '@/config/defaults';

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures to open the circuit */
  failureThreshold: number;
  /** Time in milliseconds before attempting to close the circuit */
  resetTimeoutMs: number;
  /** Maximum calls allowed in half-open state */
  halfOpenMaxCalls: number;
}

/**
 * Circuit breaker statistics.
 */
export interface CircuitBreakerStats {
  /** Current state of the circuit */
  state: CircuitState;
  /** Number of consecutive failures */
  failureCount: number;
  /** Total number of successful calls */
  successCount: number;
  /** Total number of failed calls */
  totalFailures: number;
  /** Last failure timestamp */
  lastFailureAt: Date | null;
  /** Last state change timestamp */
  lastStateChangeAt: Date | null;
  /** Number of calls in half-open state */
  halfOpenCalls: number;
}

/**
 * CircuitBreaker - Implements the circuit breaker pattern for provider resilience.
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker();
 *
 * if (breaker.canExecute(1)) {
 *   try {
 *     await executeRequest();
 *     breaker.recordSuccess(1);
 *   } catch (error) {
 *     breaker.recordFailure(1);
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly circuits: Map<number, CircuitBreakerStats> = new Map();

  /**
   * Create a new CircuitBreaker instance.
   *
   * @param config - Circuit breaker configuration
   */
  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? CIRCUIT_BREAKER_DEFAULTS.failureThreshold,
      resetTimeoutMs: config.resetTimeoutMs ?? CIRCUIT_BREAKER_DEFAULTS.resetTimeoutMs,
      halfOpenMaxCalls: config.halfOpenMaxCalls ?? CIRCUIT_BREAKER_DEFAULTS.halfOpenMaxCalls,
    };
  }

  /**
   * Check if a request can be executed for the given plan.
   *
   * @param planId - The plan identifier
   * @returns true if the request can proceed, false if the circuit is open
   */
  canExecute(planId: number): boolean {
    const stats = this.getOrCreateStats(planId);
    const now = new Date();

    switch (stats.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if enough time has passed to transition to half-open
        if (stats.lastFailureAt) {
          const elapsed = now.getTime() - stats.lastFailureAt.getTime();
          if (elapsed >= this.config.resetTimeoutMs) {
            this.transitionTo(planId, 'half-open');
            return true;
          }
        }
        return false;

      case 'half-open':
        // Allow limited calls in half-open state
        return stats.halfOpenCalls < this.config.halfOpenMaxCalls;

      default:
        return false;
    }
  }

  /**
   * Record a successful call for the given plan.
   *
   * @param planId - The plan identifier
   */
  recordSuccess(planId: number): void {
    const stats = this.getOrCreateStats(planId);
    stats.failureCount = 0;
    stats.successCount += 1;
    stats.halfOpenCalls = 0;

    if (stats.state === 'half-open') {
      this.transitionTo(planId, 'closed');
    }

    logger.debug('Circuit breaker success recorded', {
      planId,
      state: stats.state,
      successCount: stats.successCount,
    });
  }

  /**
   * Record a failed call for the given plan.
   *
   * @param planId - The plan identifier
   */
  recordFailure(planId: number): void {
    const stats = this.getOrCreateStats(planId);
    const now = new Date();

    stats.failureCount += 1;
    stats.totalFailures += 1;
    stats.lastFailureAt = now;

    if (stats.state === 'half-open') {
      // Failure in half-open state -> back to open
      this.transitionTo(planId, 'open');
    } else if (stats.state === 'closed' && stats.failureCount >= this.config.failureThreshold) {
      // Threshold exceeded -> open the circuit
      this.transitionTo(planId, 'open');
    }

    logger.warn('Circuit breaker failure recorded', {
      planId,
      state: stats.state,
      failureCount: stats.failureCount,
      failureThreshold: this.config.failureThreshold,
    });
  }

  /**
   * Get the current state of the circuit for a plan.
   *
   * @param planId - The plan identifier
   * @returns The current circuit state
   */
  getState(planId: number): CircuitState {
    const stats = this.getOrCreateStats(planId);

    // Check for automatic state transition
    if (stats.state === 'open' && stats.lastFailureAt) {
      const elapsed = Date.now() - stats.lastFailureAt.getTime();
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo(planId, 'half-open');
      }
    }

    return stats.state;
  }

  /**
   * Get statistics for a plan's circuit.
   *
   * @param planId - The plan identifier
   * @returns Circuit breaker statistics
   */
  getStats(planId: number): CircuitBreakerStats {
    return this.getOrCreateStats(planId);
  }

  /**
   * Manually reset the circuit for a plan.
   *
   * @param planId - The plan identifier
   */
  reset(planId: number): void {
    const stats = this.getOrCreateStats(planId);
    stats.state = 'closed';
    stats.failureCount = 0;
    stats.halfOpenCalls = 0;
    stats.lastStateChangeAt = new Date();

    logger.info('Circuit breaker manually reset', { planId });
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    for (const [planId] of this.circuits) {
      this.reset(planId);
    }
    logger.info('All circuit breakers reset');
  }

  /**
   * Check if the circuit is open for a plan.
   *
   * @param planId - The plan identifier
   * @returns true if the circuit is open (requests should be blocked)
   */
  isOpen(planId: number): boolean {
    return !this.canExecute(planId);
  }

  /**
   * Get the number of plans with open circuits.
   *
   * @returns Number of plans with open circuits
   */
  getOpenCircuitCount(): number {
    let count = 0;
    for (const [, stats] of this.circuits) {
      if (stats.state === 'open') {
        count++;
      }
    }
    return count;
  }

  /**
   * Get or create stats for a plan.
   */
  private getOrCreateStats(planId: number): CircuitBreakerStats {
    if (!this.circuits.has(planId)) {
      const now = new Date();
      const stats: CircuitBreakerStats = {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        totalFailures: 0,
        lastFailureAt: null,
        lastStateChangeAt: now,
        halfOpenCalls: 0,
      };
      this.circuits.set(planId, stats);
    }
    return this.circuits.get(planId)!;
  }

  /**
   * Transition the circuit to a new state.
   */
  private transitionTo(planId: number, newState: CircuitState): void {
    const stats = this.getOrCreateStats(planId);
    const oldState = stats.state;

    if (oldState === newState) {
      return;
    }

    stats.state = newState;
    stats.lastStateChangeAt = new Date();

    if (newState === 'half-open') {
      stats.halfOpenCalls = 0;
    }

    logger.info('Circuit breaker state changed', {
      planId,
      oldState,
      newState,
    });
  }
}

/**
 * Create a new CircuitBreaker instance.
 *
 * @param config - Optional circuit breaker configuration
 * @returns A new CircuitBreaker instance
 */
export function createCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  return new CircuitBreaker(config);
}
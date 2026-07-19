/**
 * Unit tests for CircuitBreaker service.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, createCircuitBreaker } from '@/services/circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = createCircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxCalls: 2,
    });
  });

  describe('constructor', () => {
    it('should create a CircuitBreaker instance', () => {
      expect(breaker).toBeInstanceOf(CircuitBreaker);
    });

    it('should use default config when not provided', () => {
      const defaultBreaker = createCircuitBreaker();
      expect(defaultBreaker).toBeInstanceOf(CircuitBreaker);
    });
  });

  describe('canExecute', () => {
    it('should return true for new plan (closed state)', () => {
      expect(breaker.canExecute('plan-1')).toBe(true);
    });

    it('should return true for closed circuit', () => {
      breaker.recordSuccess('plan-1');
      expect(breaker.canExecute('plan-1')).toBe(true);
    });

    it('should return false after failure threshold reached', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      expect(breaker.canExecute('plan-1')).toBe(false);
    });

    it('should allow calls in half-open state after reset timeout', async () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(breaker.canExecute('plan-1')).toBe(true);
    });

    it('caps half-open probe calls at halfOpenMaxCalls (H7)', async () => {
      // halfOpenMaxCalls is 2 in this suite's config.
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // First call transitions open->half-open and counts as probe 1.
      expect(breaker.canExecute('plan-1')).toBe(true); // probe 1
      expect(breaker.canExecute('plan-1')).toBe(true); // probe 2
      // Third probe exceeds halfOpenMaxCalls -> blocked until a result arrives.
      expect(breaker.canExecute('plan-1')).toBe(false);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count on success', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordSuccess('plan-1');

      const stats = breaker.getStats('plan-1');
      expect(stats.failureCount).toBe(0);
      expect(stats.state).toBe('closed');
    });

    it('should transition from half-open to closed on success', async () => {
      // Open the circuit
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      // Wait for reset timeout to enter half-open
      await new Promise((resolve) => setTimeout(resolve, 150));

      breaker.canExecute('plan-1'); // Triggers transition to half-open
      breaker.recordSuccess('plan-1');

      expect(breaker.getState('plan-1')).toBe('closed');
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', () => {
      breaker.recordFailure('plan-1');
      const stats = breaker.getStats('plan-1');
      expect(stats.failureCount).toBe(1);
      expect(stats.totalFailures).toBe(1);
    });

    it('should open circuit after threshold failures', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      expect(breaker.getState('plan-1')).toBe('open');
    });

    it('should transition from half-open to open on failure', async () => {
      // Open the circuit
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      breaker.canExecute('plan-1'); // Triggers half-open
      breaker.recordFailure('plan-1'); // Should go back to open

      expect(breaker.getState('plan-1')).toBe('open');
    });
  });

  describe('getState', () => {
    it('should return closed for new plan', () => {
      expect(breaker.getState('plan-1')).toBe('closed');
    });

    it('should return open after threshold failures', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      expect(breaker.getState('plan-1')).toBe('open');
    });
  });

  describe('getStats', () => {
    it('should return stats for a plan', () => {
      const stats = breaker.getStats('plan-1');

      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('failureCount');
      expect(stats).toHaveProperty('successCount');
      expect(stats).toHaveProperty('totalFailures');
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset a specific plan', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      breaker.reset('plan-1');

      expect(breaker.getState('plan-1')).toBe('closed');
      expect(breaker.canExecute('plan-1')).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('should reset all plans', () => {
      // Open circuits for multiple plans
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      breaker.recordFailure('plan-2');
      breaker.recordFailure('plan-2');
      breaker.recordFailure('plan-2');

      breaker.resetAll();

      expect(breaker.getState('plan-1')).toBe('closed');
      expect(breaker.getState('plan-2')).toBe('closed');
    });
  });

  describe('isOpen', () => {
    it('should return false for closed circuit', () => {
      expect(breaker.isOpen('plan-1')).toBe(false);
    });

    it('should return true for open circuit', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      expect(breaker.isOpen('plan-1')).toBe(true);
    });
  });

  describe('getOpenCircuitCount', () => {
    it('should return 0 when no circuits are open', () => {
      expect(breaker.getOpenCircuitCount()).toBe(0);
    });

    it('should return count of open circuits', () => {
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');
      breaker.recordFailure('plan-1');

      breaker.recordFailure('plan-2');
      breaker.recordFailure('plan-2');
      breaker.recordFailure('plan-2');

      expect(breaker.getOpenCircuitCount()).toBe(2);
    });
  });
});

describe('createCircuitBreaker', () => {
  it('should create a CircuitBreaker instance', () => {
    const breaker = createCircuitBreaker();
    expect(breaker).toBeInstanceOf(CircuitBreaker);
  });

  it('should accept custom configuration', () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 10,
      resetTimeoutMs: 30000,
    });
    expect(breaker).toBeInstanceOf(CircuitBreaker);
  });
});
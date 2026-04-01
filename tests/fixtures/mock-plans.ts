/**
 * Test fixtures for mock coding plans.
 * Provides consistent test data across test suites.
 */

import type { CodingPlan, QuotaConfig, QuotaState, CreateCodingPlanInput } from '@/types';

/**
 * Sample quota configurations.
 */
export const mockQuotaConfigs: Record<string, QuotaConfig> = {
  daily: { limit: 100, period: 'daily' },
  monthly: { limit: 1000, period: 'monthly' },
  total: { limit: 5000, period: 'total' },
};

/**
 * Create a mock coding plan.
 */
export function createMockPlan(overrides: Partial<CodingPlan> = {}): CodingPlan {
  const now = new Date();
  return {
    id: 1,
    name: 'Test Plan',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEncrypted: 'enc:1234567890abcdef:fedcba0987654321:0123456789abcdef',
    models: ['model-1', 'model-2'],
    quota: mockQuotaConfigs.monthly,
    timeout: 30000,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create multiple mock plans with different configurations.
 */
export function createMockPlans(): CodingPlan[] {
  const now = new Date();
  return [
    {
      id: 1,
      name: 'Kimi K2.5 Plan',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKeyEncrypted: 'enc:abc123:def456:ghi789',
      models: ['kimi-k2.5', 'kimi-k2'],
      quota: { limit: 1000, period: 'monthly' },
      timeout: 30000,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 2,
      name: 'Claude Plan',
      baseUrl: 'https://api.anthropic.com',
      apiKeyEncrypted: 'enc:jkl012:mno345:pqr678',
      models: ['claude-sonnet-4-6', 'claude-opus-4-6'],
      quota: { limit: 500, period: 'monthly' },
      timeout: 30000,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 3,
      name: 'OpenAI Plan',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEncrypted: 'enc:stu901:vwx234:yza567',
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      quota: { limit: 2000, period: 'monthly' },
      timeout: 60000,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 4,
      name: 'Paused Plan',
      baseUrl: 'https://api.paused.com/v1',
      apiKeyEncrypted: 'enc:bcd890:efg123:hij456',
      models: ['paused-model'],
      quota: { limit: 100, period: 'daily' },
      timeout: 30000,
      status: 'paused',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 5,
      name: 'Exhausted Plan',
      baseUrl: 'https://api.exhausted.com/v1',
      apiKeyEncrypted: 'enc:klm789:nop012:qrs345',
      models: ['exhausted-model'],
      quota: { limit: 10, period: 'total' },
      timeout: 30000,
      status: 'exhausted',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/**
 * Create a mock quota state.
 */
export function createMockQuotaState(overrides: Partial<QuotaState> = {}): QuotaState {
  return {
    planId: 1,
    used: 50,
    limit: 1000,
    period: 'monthly',
    lastUpdated: new Date(),
    resetAt: new Date('2030-04-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Create multiple mock quota states.
 */
export function createMockQuotaStates(): QuotaState[] {
  return [
    createMockQuotaState({ planId: 1, used: 450, limit: 1000 }),
    createMockQuotaState({ planId: 2, used: 200, limit: 500 }),
    createMockQuotaState({ planId: 3, used: 1500, limit: 2000 }),
    createMockQuotaState({ planId: 4, used: 50, limit: 100 }),
    createMockQuotaState({ planId: 5, used: 10, limit: 10 }),
  ];
}

/**
 * Create a mock plan creation input.
 */
export function createMockPlanInput(overrides: Partial<CreateCodingPlanInput & { expiresOn?: number; expiresAt?: string; weight?: number }> = {}): CreateCodingPlanInput {
  return {
    name: 'New Test Plan',
    baseUrl: 'https://api.newplan.com/v1',
    apiKey: 'sk-test-api-key-12345',
    models: ['new-model-1', 'new-model-2'],
    quota: { limit: 500, period: 'monthly' },
    ...overrides,
  };
}

/**
 * Plan IDs for testing.
 */
export const MOCK_PLAN_IDS = {
  valid: 1,
  notFound: 999999,
  invalid: 'not-an-integer',
};

/**
 * Model names for testing.
 */
export const MOCK_MODELS = {
  supported: 'claude-sonnet-4-6',
  unsupported: 'unknown-model-xyz',
  caseSensitive: 'Claude-Sonnet-4-6',
};
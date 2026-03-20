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
    id: '550e8400-e29b-41d4-a716-446655440000',
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
      id: 'plan-1-kimi',
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
      id: 'plan-2-claude',
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
      id: 'plan-3-openai',
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
      id: 'plan-4-paused',
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
      id: 'plan-5-exhausted',
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
    planId: '550e8400-e29b-41d4-a716-446655440000',
    used: 50,
    limit: 1000,
    period: 'monthly',
    lastUpdated: new Date(),
    resetAt: new Date('2026-04-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Create multiple mock quota states.
 */
export function createMockQuotaStates(): QuotaState[] {
  return [
    createMockQuotaState({ planId: 'plan-1-kimi', used: 450, limit: 1000 }),
    createMockQuotaState({ planId: 'plan-2-claude', used: 200, limit: 500 }),
    createMockQuotaState({ planId: 'plan-3-openai', used: 1500, limit: 2000 }),
    createMockQuotaState({ planId: 'plan-4-paused', used: 50, limit: 100 }),
    createMockQuotaState({ planId: 'plan-5-exhausted', used: 10, limit: 10 }),
  ];
}

/**
 * Create a mock plan creation input.
 */
export function createMockPlanInput(overrides: Partial<CreateCodingPlanInput> = {}): CreateCodingPlanInput {
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
  valid: '550e8400-e29b-41d4-a716-446655440000',
  notFound: '00000000-0000-0000-0000-000000000000',
  invalid: 'not-a-uuid',
};

/**
 * Model names for testing.
 */
export const MOCK_MODELS = {
  supported: 'claude-sonnet-4-6',
  unsupported: 'unknown-model-xyz',
  caseSensitive: 'Claude-Sonnet-4-6',
};
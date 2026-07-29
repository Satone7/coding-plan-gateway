/**
 * Unit tests for ModelRoutingService and ContextDowngradeStrategy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ModelRoutingService,
  ContextDowngradeStrategy,
  createModelRoutingService,
} from '@/services/model-router';
import { TokenCounter } from '@/utils/token-counter';
import type { ModelRoutingRequest } from '@/types/model-routing';

function openaiBody(text: string): unknown {
  return { model: 'k3', messages: [{ role: 'user', content: text }] };
}

function anthropicBody(text: string): unknown {
  return { model: 'k3', max_tokens: 1024, messages: [{ role: 'user', content: text }] };
}

function req(
  requestedModel: string,
  body: unknown,
  format: 'openai' | 'anthropic' = 'openai'
): ModelRoutingRequest {
  return { requestedModel, body, format };
}

const k3To256k = {
  rules: [{ from: 'k3', to: 'k3-256k', when: { inputTokensLte: 1000 } }],
};

describe('ContextDowngradeStrategy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites when estimated input tokens are within the threshold', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const strategy = new ContextDowngradeStrategy();
    const outcome = strategy.resolve(req('k3', openaiBody('hi')), k3To256k);
    expect(outcome).not.toBeNull();
    expect(outcome?.rewritten).toBe(true);
    expect(outcome?.model).toBe('k3-256k');
    expect(outcome?.strategyId).toBe('context-downgrade');
    expect(outcome?.estimatedInputTokens).toBe(500);
  });

  it('does not rewrite when estimated input tokens exceed the threshold', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(2000);
    const strategy = new ContextDowngradeStrategy();
    const outcome = strategy.resolve(req('k3', openaiBody('big')), k3To256k);
    expect(outcome).toBeNull();
  });

  it('does not rewrite and skips token estimation when no rule matches', () => {
    const estimator = vi
      .spyOn(TokenCounter, 'estimateOpenAIInputTokens')
      .mockReturnValue(10);
    const strategy = new ContextDowngradeStrategy();
    const outcome = strategy.resolve(req('glm-5', openaiBody('hi')), k3To256k);
    expect(outcome).toBeNull();
    expect(estimator).not.toHaveBeenCalled();
  });

  it('matches `from` case-insensitively and uses the first matching rule', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const strategy = new ContextDowngradeStrategy();
    const params = {
      rules: [
        { from: 'K3', to: 'k3-256k', when: { inputTokensLte: 1000 } },
        { from: 'k3', to: 'should-not-win', when: { inputTokensLte: 1000 } },
      ],
    };
    const outcome = strategy.resolve(req('k3', openaiBody('hi')), params);
    expect(outcome?.model).toBe('k3-256k');
  });

  it('uses the Anthropic estimator for the anthropic format', () => {
    const openSpy = vi
      .spyOn(TokenCounter, 'estimateOpenAIInputTokens')
      .mockReturnValue(9999);
    const anthropicSpy = vi
      .spyOn(TokenCounter, 'estimateAnthropicInputTokens')
      .mockReturnValue(300);
    const strategy = new ContextDowngradeStrategy();
    const outcome = strategy.resolve(req('k3', anthropicBody('hi'), 'anthropic'), k3To256k);
    expect(anthropicSpy).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(outcome?.model).toBe('k3-256k');
  });

  it('returns null when params contain no valid rules', () => {
    const strategy = new ContextDowngradeStrategy();
    expect(strategy.resolve(req('k3', {}), {})).toBeNull();
    // Rule missing required `to`/`when` → filtered out → no rules
    expect(strategy.resolve(req('k3', {}), { rules: [{ from: 'k3' }] })).toBeNull();
  });
});

describe('ModelRoutingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through when disabled', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const svc = createModelRoutingService({
      enabled: false,
      strategies: [{ id: 'context-downgrade', rules: k3To256k.rules }],
    });
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.rewritten).toBe(false);
    expect(outcome.model).toBe('k3');
  });

  it('passes through when no config is provided', () => {
    const svc = createModelRoutingService();
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.rewritten).toBe(false);
  });

  it('applies the strategy when enabled and input fits', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const svc = createModelRoutingService({
      enabled: true,
      strategies: [{ id: 'context-downgrade', enabled: true, rules: k3To256k.rules }],
    });
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.rewritten).toBe(true);
    expect(outcome.model).toBe('k3-256k');
  });

  it('skips a disabled strategy entry', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const svc = createModelRoutingService({
      enabled: true,
      strategies: [{ id: 'context-downgrade', enabled: false, rules: k3To256k.rules }],
    });
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.rewritten).toBe(false);
    expect(outcome.model).toBe('k3');
  });

  it('skips unknown strategy ids without crashing', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const svc = createModelRoutingService({
      enabled: true,
      strategies: [{ id: 'does-not-exist', rules: [] }],
    });
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.rewritten).toBe(false);
    expect(outcome.model).toBe('k3');
  });

  it('iterates strategies in config order; first rewrite wins', () => {
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(500);
    const svc = createModelRoutingService({
      enabled: true,
      strategies: [
        { id: 'always-a', rules: [] },
        { id: 'context-downgrade', rules: k3To256k.rules },
      ],
    });
    // Register a real always-rewrite strategy that takes precedence (listed first).
    svc.register({
      id: 'always-a',
      resolve: () => ({ model: 'always-a-result', rewritten: true, strategyId: 'always-a' }),
    });
    const outcome = svc.resolve(req('k3', openaiBody('hi')));
    expect(outcome.model).toBe('always-a-result');
    expect(outcome.strategyId).toBe('always-a');
  });

  it('is registered with the context-downgrade strategy by default', () => {
    // Sanity: a fresh service exposes the built-in strategy via the registry.
    const svc = createModelRoutingService();
    expect(svc).toBeInstanceOf(ModelRoutingService);
    // Indirectly: enabling it with a k3 rule rewrites when tokens fit.
    vi.spyOn(TokenCounter, 'estimateOpenAIInputTokens').mockReturnValue(1);
    const enabled = createModelRoutingService({
      enabled: true,
      strategies: [{ id: 'context-downgrade', rules: k3To256k.rules }],
    });
    expect(enabled.resolve(req('k3', openaiBody('x'))).model).toBe('k3-256k');
  });
});

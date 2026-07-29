/**
 * ModelRoutingService — content-aware model rewriting, run before plan selection.
 *
 * Given `{requestedModel, body, format}`, returns the effective model to route
 * on. Strategies are configured declaratively under `modelRouting` and iterated
 * in order; the first to rewrite wins. When routing is disabled or no strategy
 * applies, the requested model is passed through unchanged.
 *
 * @see src/types/model-routing.ts for the strategy contract and config shape.
 * @module services/model-router
 */

import { TokenCounter } from '@/utils/token-counter';
import type { AnthropicMessageRequest } from '@/types/anthropic';
import type { ChatCompletionRequest } from '@/types/openai';
import { logger } from '@/utils/logger';
import {
  DEFAULT_MODEL_ROUTING_CONFIG,
  type ContextDowngradeParams,
  type ContextDowngradeRule,
  type ModelRoutingConfig,
  type ModelRoutingOutcome,
  type ModelRoutingRequest,
  type ModelRoutingStrategy,
} from '@/types/model-routing';

/** A passthrough outcome (no rewrite). */
function passthrough(model: string): ModelRoutingOutcome {
  return { model, rewritten: false };
}

/** Type guard for a valid context-downgrade rule. */
function isContextDowngradeRule(value: unknown): value is ContextDowngradeRule {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const rule = value as Record<string, unknown>;
  const when = rule.when as Record<string, unknown> | undefined;
  return (
    typeof rule.from === 'string' && rule.from.trim() !== '' &&
    typeof rule.to === 'string' && rule.to.trim() !== '' &&
    !!when && typeof when.inputTokensLte === 'number' && when.inputTokensLte > 0
  );
}

/** Estimate input tokens for a request using the format-appropriate estimator. */
function estimateInputTokens(request: ModelRoutingRequest): number {
  try {
    if (request.format === 'anthropic') {
      return TokenCounter.estimateAnthropicInputTokens(
        request.body as AnthropicMessageRequest
      );
    }
    return TokenCounter.estimateOpenAIInputTokens(request.body as ChatCompletionRequest);
  } catch (error) {
    // Estimation must never break routing — fall back to a safe (large) estimate
    // so the strategy declines to rewrite rather than crashing the request.
    logger.warn('Model routing token estimation failed, skipping rewrite', {
      requestedModel: request.requestedModel,
      format: request.format,
      error: error instanceof Error ? error.message : String(error),
    });
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Strategy: downgrade to a smaller-context model variant when the input fits.
 *
 * Matches the requested model against each rule's `from` (case-insensitive);
 * for the first match, estimates input tokens and rewrites to `to` only when
 * the estimate is ≤ `when.inputTokensLte`. Token estimation runs ONLY when a
 * rule's `from` matches, so requests for unrelated models pay zero cost.
 *
 * Note: k3-256k lacks video input support that k3 has. This strategy is
 * context-only by design; a future capability guard can be added via the `when`
 * clause without changing this contract.
 */
export class ContextDowngradeStrategy implements ModelRoutingStrategy {
  readonly id = 'context-downgrade';

  resolve(request: ModelRoutingRequest, params: unknown): ModelRoutingOutcome | null {
    const rules = this.extractRules(params);
    if (rules.length === 0) {
      return null;
    }

    const requestedLower = request.requestedModel.toLowerCase().trim();
    const rule = rules.find((r) => r.from.toLowerCase().trim() === requestedLower);
    if (!rule) {
      // No matching rule → do not rewrite and do not spend time estimating tokens.
      return null;
    }

    const estimatedInputTokens = estimateInputTokens(request);
    const limit = rule.when.inputTokensLte;
    if (estimatedInputTokens <= limit) {
      return {
        model: rule.to,
        rewritten: true,
        strategyId: this.id,
        estimatedInputTokens,
        reason: `input ${estimatedInputTokens} tokens <= ${limit} threshold`,
      };
    }
    return null;
  }

  /** Validate and collect rules from the strategy params. */
  private extractRules(params: unknown): ContextDowngradeRule[] {
    if (!params || typeof params !== 'object') {
      return [];
    }
    const p = params as Partial<ContextDowngradeParams>;
    if (!Array.isArray(p.rules)) {
      return [];
    }
    return p.rules.filter(isContextDowngradeRule);
  }
}

/**
 * Orchestrates model routing strategies.
 *
 * Built-in strategies are registered in the constructor. The active strategies
 * and their order come from the `modelRouting` config; unknown strategy ids in
 * config are logged and skipped (they do not crash routing).
 */
export class ModelRoutingService {
  private readonly config: ModelRoutingConfig;
  private readonly strategies: Map<string, ModelRoutingStrategy>;

  constructor(config?: ModelRoutingConfig) {
    this.config = config ?? DEFAULT_MODEL_ROUTING_CONFIG;
    this.strategies = new Map<string, ModelRoutingStrategy>();
    this.register(new ContextDowngradeStrategy());
  }

  /** Register a strategy implementation by id. */
  register(strategy: ModelRoutingStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Resolve the effective model for a request.
   * Iterates enabled strategies in config order; the first rewrite wins.
   */
  resolve(request: ModelRoutingRequest): ModelRoutingOutcome {
    if (this.config.enabled === false || !this.config.strategies) {
      return passthrough(request.requestedModel);
    }

    for (const strategyConfig of this.config.strategies) {
      if (strategyConfig.enabled === false) {
        continue;
      }
      const strategy = this.strategies.get(strategyConfig.id);
      if (!strategy) {
        logger.warn('Unknown model routing strategy in config, skipping', {
          strategyId: strategyConfig.id,
        });
        continue;
      }

      const outcome = strategy.resolve(request, strategyConfig);
      if (outcome?.rewritten) {
        logger.info('Model routing applied', {
          requestedModel: request.requestedModel,
          effectiveModel: outcome.model,
          strategyId: outcome.strategyId,
          reason: outcome.reason,
          estimatedInputTokens: outcome.estimatedInputTokens,
        });
        return outcome;
      }
    }

    return passthrough(request.requestedModel);
  }
}

/** Create a ModelRoutingService bound to the given config (or disabled by default). */
export function createModelRoutingService(config?: ModelRoutingConfig): ModelRoutingService {
  return new ModelRoutingService(config);
}

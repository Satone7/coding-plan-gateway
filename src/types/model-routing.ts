/**
 * Model routing types for content-aware model rewriting strategies.
 *
 * The gateway has two orthogonal routing layers:
 *  1. Load balancing (`loadBalancing`) — picks WHICH plan serves a given model.
 *  2. Model routing (this module) — rewrites WHICH model a request should use,
 *     based on request content (e.g. downgrade k3 → k3-256k when the input fits
 *     in 256k tokens).
 *
 * Model routing runs as a pre-routing step inside the request handlers, BEFORE
 * plan selection (`RequestRouter.route`). The plan-selection pipeline stays
 * 100% model-name-keyed and unchanged; only the model name fed into it may be
 * rewritten here.
 *
 * Strategies are pluggable: add a new strategy by implementing
 * `ModelRoutingStrategy` and registering it in `ModelRoutingService`. Strategies
 * are configured declaratively under the top-level `modelRouting` config key and
 * iterated in order; the first strategy to rewrite wins.
 */

/** Wire formats supported by the gateway. */
export type ModelRoutingFormat = 'openai' | 'anthropic';

/** Input to a model routing decision. */
export interface ModelRoutingRequest {
  /** The model name the client requested (before any rewrite). */
  requestedModel: string;
  /** The parsed request body (OpenAI or Anthropic shape). */
  body: unknown;
  /** The wire format of the request, selecting the token estimator. */
  format: ModelRoutingFormat;
}

/** The decision produced by a model routing strategy. */
export interface ModelRoutingOutcome {
  /** Effective model to route on. Equals `requestedModel` when not rewritten. */
  model: string;
  /** Whether a rewrite was applied. */
  rewritten: boolean;
  /** Id of the strategy that produced the rewrite, if any. */
  strategyId?: string;
  /** Human-readable reason for the rewrite, for logging. */
  reason?: string;
  /** Estimated input token count, if a strategy computed it. */
  estimatedInputTokens?: number;
}

/**
 * A pluggable model routing strategy.
 *
 * Returns `null` when the strategy does not apply (no rewrite); returns an
 * outcome when it rewrites the requested model. The `params` argument is the
 * strategy's own config object from `ModelRoutingStrategyConfig` — its shape is
 * strategy-specific, so it is typed `unknown` here and validated/cast by the
 * strategy implementation.
 */
export interface ModelRoutingStrategy {
  readonly id: string;
  resolve(request: ModelRoutingRequest, params: unknown): ModelRoutingOutcome | null;
}

/**
 * Condition for the context-downgrade strategy: rewrite only when the estimated
 * input token count is at most `inputTokensLte`. Set this below the target
 * model's context window to leave headroom for output tokens and estimation
 * variance (the local tokenizer is an approximation).
 */
export interface ContextDowngradeCondition {
  /** Rewrite only when estimated input tokens ≤ this value. */
  inputTokensLte: number;
}

/** A single rewrite rule for the context-downgrade strategy. */
export interface ContextDowngradeRule {
  /** Optional id, surfaced in logs for debugging. */
  id?: string;
  /** Requested model name to match (case-insensitive). */
  from: string;
  /** Target model to rewrite to. */
  to: string;
  /** Conditions that must all hold for the rewrite. */
  when: ContextDowngradeCondition;
}

/** Params consumed by the context-downgrade strategy. */
export interface ContextDowngradeParams {
  rules: ContextDowngradeRule[];
}

/**
 * One strategy entry in the `modelRouting.strategies` config array.
 * `id` selects the strategy implementation; the remaining fields are that
 * strategy's params (e.g. `rules` for context-downgrade).
 */
export interface ModelRoutingStrategyConfig {
  /** Strategy implementation id (e.g. "context-downgrade"). */
  id: string;
  /** Whether this strategy entry is active (default true). */
  enabled?: boolean;
  /** Strategy-specific params. Shape depends on `id`. */
  [key: string]: unknown;
}

/** Top-level model routing configuration (`modelRouting` in config.yaml). */
export interface ModelRoutingConfig {
  /** Master switch for model routing (default false → pure passthrough). */
  enabled?: boolean;
  /** Ordered strategy entries; first to rewrite wins. */
  strategies?: ModelRoutingStrategyConfig[];
}

/** Default model routing config: disabled, no strategies. */
export const DEFAULT_MODEL_ROUTING_CONFIG: ModelRoutingConfig = {
  enabled: false,
  strategies: [],
};

/**
 * ModelSyncService — fetches model lists at runtime for `dynamicModels` plans.
 *
 * For each plan with `dynamicModels: true`, calls the upstream OpenAI-compatible
 * `<openaiBaseUrl>/models` endpoint (Bearer auth), filters out excluded substrings
 * (default: "embed"), and updates the plan's models in memory via
 * `repository.updateModelsInMemory` (never persisted to disk). Runs once at startup
 * and on a configurable interval. Per-plan failures are isolated: a failed/empty
 * fetch keeps the plan's prior models rather than clearing them.
 */

import type { IPlanRepository } from '@/services/plan-repository';
import type { CodingPlan } from '@/types';
import { buildModelsEndpoint } from '@/utils/url';
import { logger } from '@/utils/logger';

export interface ModelSyncDeps {
  /** Plan repository (the routing source-of-truth instance). */
  repository: IPlanRepository;
  /** Refresh interval in ms. Defaults to 5 minutes. */
  defaultIntervalMs?: number;
  /** Substrings excluded from fetched models when a plan has no `modelsExclude`. */
  defaultExcludeSubstrings?: string[];
}

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_EXCLUDE_SUBSTRINGS = ['embed'];

export class ModelSyncService {
  private readonly intervalMs: number;
  private readonly defaultExcludes: string[];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ModelSyncDeps) {
    this.intervalMs =
      deps.defaultIntervalMs && deps.defaultIntervalMs > 0
        ? deps.defaultIntervalMs
        : DEFAULT_INTERVAL_MS;
    this.defaultExcludes = deps.defaultExcludeSubstrings ?? DEFAULT_EXCLUDE_SUBSTRINGS;
  }

  /**
   * Sync all `dynamicModels` plans once. Best-effort: per-plan errors are logged
   * and skipped without aborting the remaining plans.
   */
  async syncAll(): Promise<void> {
    const plans = await this.deps.repository.findAll();
    for (const plan of plans) {
      if (!plan.dynamicModels) {
        continue;
      }
      try {
        await this.syncPlan(plan);
      } catch (err) {
        logger.warn('Dynamic model sync failed for plan', {
          planId: plan.id,
          planName: plan.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async syncPlan(plan: CodingPlan): Promise<void> {
    if (!plan.openaiBaseUrl) {
      logger.warn('dynamicModels plan has no openaiBaseUrl; skipping model fetch', {
        planId: plan.id,
        planName: plan.name,
      });
      return;
    }

    const apiKey = (await this.deps.repository.getDecryptedApiKey(plan.id)) ?? '';
    const url = buildModelsEndpoint(plan.openaiBaseUrl);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Model list API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const raw = Array.isArray(body.data)
      ? body.data
          .map((m) => m?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];

    const excludes = plan.modelsExclude ?? this.defaultExcludes;
    const filtered = applyExcludes(raw, excludes);

    if (filtered.length === 0) {
      // Keep the prior list rather than overwriting with an empty array — an empty
      // result usually means the upstream is misconfigured or all models were filtered.
      logger.warn('Dynamic model sync returned no models after filtering; keeping prior list', {
        planId: plan.id,
        planName: plan.name,
        rawCount: raw.length,
        excludes,
      });
      return;
    }

    await this.deps.repository.updateModelsInMemory(plan.id, filtered);
    logger.info('Dynamic models synced', {
      planId: plan.id,
      planName: plan.name,
      modelCount: filtered.length,
    });
  }

  /** Start the periodic refresh timer (no-op if already running). */
  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.syncAll().catch((err) => {
        logger.warn('Periodic model sync failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.intervalMs);
    logger.info('ModelSyncService started', { intervalMs: this.intervalMs });
  }

  /** Stop the periodic refresh timer (no-op if not running). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('ModelSyncService stopped');
    }
  }
}

/**
 * Filter out model IDs containing any excluded substring (case-insensitive).
 */
export function applyExcludes(models: string[], excludes: string[]): string[] {
  if (excludes.length === 0) {
    return models;
  }
  const lower = excludes.map((s) => s.toLowerCase());
  return models.filter((m) => !lower.some((sub) => m.toLowerCase().includes(sub)));
}

export function createModelSyncService(deps: ModelSyncDeps): ModelSyncService {
  return new ModelSyncService(deps);
}

/**
 * Provider Registry.
 * Merges built-in presets with config overrides and manages usage adapters.
 */

import type { ProviderPreset, ProviderOverride, UsageAdapter } from '@/types';
import { BUILTIN_PROVIDERS, mergeProviderOverride } from '@/config/builtin-providers';
import { logger } from '@/utils/logger';

/**
 * Config-level providers map: provider ID -> override or new provider.
 */
export type ProviderOverrides = Record<string, ProviderOverride>;

/**
 * Provider Registry — holds all known providers and their usage adapters.
 * Built-in presets are loaded first, then config overrides are merged in.
 */
export class ProviderRegistry {
  private readonly providers: Map<string, ProviderPreset> = new Map();
  private readonly adapters: Map<string, UsageAdapter> = new Map();

  constructor(overrides?: ProviderOverrides) {
    // Load built-in presets
    for (const preset of BUILTIN_PROVIDERS) {
      this.providers.set(preset.id, { ...preset });
    }

    // Merge config overrides (built-in presets get overridden; new providers validated+built)
    if (overrides) {
      for (const [id, override] of Object.entries(overrides)) {
        const existing = this.providers.get(id);
        const merged = mergeProviderOverride(id, override, existing);
        if (!merged) {
          logger.warn(
            'Skipping custom provider: requires name, at least one URL (baseUrl or openaiBaseUrl), and models (or dynamicModels)',
            { id }
          );
          continue;
        }
        this.providers.set(id, merged);
      }
    }

    logger.info('ProviderRegistry initialized', {
      providerCount: this.providers.size,
      providerIds: [...this.providers.keys()],
    });
  }

  getAllProviders(): ProviderPreset[] {
    return [...this.providers.values()];
  }

  getProvider(id: string): ProviderPreset | undefined {
    return this.providers.get(id);
  }

  hasUsageApi(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider?.hasUsageApi) return false;
    return this.adapters.has(id);
  }

  getUsageAdapter(id: string): UsageAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  registerUsageAdapter(adapter: UsageAdapter): void {
    const provider = this.providers.get(adapter.providerId);
    if (!provider) {
      logger.warn('Cannot register adapter for unknown provider', {
        providerId: adapter.providerId,
      });
      return;
    }
    this.adapters.set(adapter.providerId, adapter);
    logger.info('Usage adapter registered', {
      providerId: adapter.providerId,
    });
  }
}

export function createProviderRegistry(overrides?: ProviderOverrides): ProviderRegistry {
  return new ProviderRegistry(overrides);
}

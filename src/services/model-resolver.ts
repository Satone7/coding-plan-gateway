/**
 * ModelResolver - Handles model name normalization and alias resolution.
 *
 * Provides case-insensitive model name matching and alias support for request routing.
 * Maps user-provided model names (with any case) to canonical names stored in plans.
 */

import { logger } from '@/utils/logger';

/**
 * Result of model name resolution.
 */
export interface ModelResolutionResult {
  /** The normalized/canonical model name for matching against plan models */
  canonicalName: string;
  /** The original model name from the request (for upstream) */
  originalName: string;
  /** Whether the model was resolved from an alias */
  wasAlias: boolean;
  /** The alias if wasAlias is true, undefined otherwise */
  resolvedAlias?: string;
}

/**
 * Built-in model aliases for common naming variations.
 * Maps alias -> canonical model name.
 */
export const MODEL_ALIASES: Record<string, string> = {
  // GPT aliases
  'gpt-4': 'gpt-4-turbo',
  'gpt-4-32k': 'gpt-4-32k-context',
  'gpt-3.5-turbo': 'gpt-3.5-turbo-0125',

  // Claude aliases
  'claude-3': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',

  // MiniMax aliases (from spec requirement)
  'minimax-m2.5': 'MiniMax-M2.5',
  'minimax-m2': 'MiniMax-M2',
};

/**
 * ModelResolver - Handles model name normalization and alias resolution.
 *
 * @example
 * ```typescript
 * const resolver = new ModelResolver();
 *
 * // Resolve with alias
 * const result = resolver.resolveWithOriginal('gpt-4');
 * // result.canonicalName = 'gpt-4-turbo' (for plan matching)
 * // result.originalName = 'gpt-4' (for upstream)
 * // result.wasAlias = true
 * // result.resolvedAlias = 'gpt-4'
 * ```
 */
export class ModelResolver {
  /**
   * Resolve a model name to its canonical form.
   * 1. Normalize input (trim, lowercase)
   * 2. Check if it's an alias → resolve to canonical
   * 3. Return canonical name for matching
   *
   * @param modelName - The model name from the request
   * @returns The canonical model name for plan matching
   */
  resolve(modelName: string): string {
    const result = this.resolveWithOriginal(modelName);
    return result.canonicalName;
  }

  /**
   * Resolve to canonical name but preserve original for upstream.
   * Used when we need both canonical (for matching) and original (for forwarding).
   *
   * @param modelName - The model name from the request
   * @returns Resolution result with canonical and original names
   */
  resolveWithOriginal(modelName: string): ModelResolutionResult {
    const originalName = modelName.trim();
    const normalizedName = originalName.toLowerCase();

    // Check if the normalized name is a known alias
    const alias = MODEL_ALIASES[normalizedName];

    if (alias) {
      logger.debug('Model alias resolved', {
        original: originalName,
        alias: normalizedName,
        canonical: alias,
      });

      return {
        canonicalName: alias,
        originalName,
        wasAlias: true,
        resolvedAlias: normalizedName,
      };
    }

    // Not an alias - return normalized but preserve original case for upstream
    logger.debug('Model name normalized (no alias)', {
      original: originalName,
      normalized: normalizedName,
    });

    return {
      canonicalName: normalizedName,
      originalName,
      wasAlias: false,
    };
  }

  /**
   * Get all known aliases.
   * Useful for debugging or listing available aliases.
   *
   * @returns Record of alias -> canonical mappings
   */
  getAliases(): Record<string, string> {
    return { ...MODEL_ALIASES };
  }

  /**
   * Check if a model name is an alias.
   *
   * @param modelName - The model name to check
   * @returns true if the model name is a known alias
   */
  isAlias(modelName: string): boolean {
    const normalized = modelName.toLowerCase().trim();
    return normalized in MODEL_ALIASES;
  }
}

/**
 * Create a new ModelResolver instance.
 *
 * @returns A new ModelResolver instance
 */
export function createModelResolver(): ModelResolver {
  return new ModelResolver();
}
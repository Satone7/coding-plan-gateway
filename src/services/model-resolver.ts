/**
 * ModelResolver - Handles model name normalization and alias resolution.
 *
 * Provides case-insensitive model name matching and alias support for request routing.
 * Maps user-provided model names (with any case) to canonical names stored in plans.
 */

import { logger } from '@/utils/logger';

/**
 * Type for model aliases (alias -> canonical model name).
 */
export type ModelAliases = Record<string, string>;

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
 * Options for ModelResolver constructor.
 */
export interface ModelResolverOptions {
  /** Initial model aliases to use */
  aliases?: ModelAliases;
  /** Whether to validate for circular references at startup */
  validateCircular?: boolean;
}

/**
 * ModelResolver - Handles model name normalization and alias resolution.
 *
 * @example
 * ```typescript
 * const resolver = new ModelResolver({ aliases: { 'gpt-4': 'gpt-4-turbo' } });
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
  private aliases: ModelAliases;

  /**
   * Create a new ModelResolver instance.
   *
   * @param options - Configuration options
   */
  constructor(options: ModelResolverOptions = {}) {
    const aliases = options.aliases ?? {};

    // Validate circular references if enabled (default: true for constructor)
    if (options.validateCircular !== false) {
      const circularError = ModelResolver.detectCircularAliases(aliases);
      if (circularError) {
        throw new Error(circularError);
      }
    }

    this.aliases = aliases;
  }

  /**
   * Detect circular references in alias configuration.
   * Checks for circular chains (a: b, b: a or a: b, b: c, c: a).
   *
   * Note: A cycle only exists if the canonical name matches an EXACT alias key.
   * For example, "minimax-m2.5": "MiniMax-M2.5" is NOT a cycle because
   * "MiniMax-M2.5" (the canonical) is not a key in the aliases - only "minimax-m2.5" is.
   *
   * @param aliases - The alias map to validate
   * @returns Error message if circular references found, null otherwise
   */
  static detectCircularAliases(aliases: ModelAliases): string | null {
    // Get all alias keys (both lowercase and original)
    const aliasKeys = new Set(Object.keys(aliases));

    // Check for circular chains using DFS
    // A cycle exists only if the canonical name is an EXACT alias key (same case)
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function hasCycle(node: string): boolean {
      visited.add(node);
      recursionStack.add(node);

      // Get the canonical name
      const canonical = aliases[node];
      if (!canonical) {
        // No mapping - end of chain, not a cycle
        recursionStack.delete(node);
        return false;
      }

      // Only follow the path if the canonical is ALSO an exact alias key (same case)
      // This is what creates a cycle - if the target is not an alias key, there's no cycle
      if (aliasKeys.has(canonical)) {
        if (!visited.has(canonical)) {
          if (hasCycle(canonical)) {
            return true;
          }
        } else if (recursionStack.has(canonical)) {
          // Found a cycle
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    }

    for (const alias of Object.keys(aliases)) {
      if (!visited.has(alias)) {
        if (hasCycle(alias)) {
          // Build cycle path for error message
          const cycle: string[] = [alias];
          let current = aliases[alias];
          while (current && current !== alias && aliasKeys.has(current)) {
            cycle.push(current);
            current = aliases[current];
          }
          cycle.push(alias);
          return `Circular alias chain detected: ${cycle.join(' -> ')}`;
        }
      }
    }

    return null;
  }

  /**
   * Update aliases at runtime (for hot-reload support).
   *
   * @param aliases - New alias map to use
   * @throws Error if circular references are detected
   */
  updateAliases(aliases: ModelAliases): void {
    const circularError = ModelResolver.detectCircularAliases(aliases);
    if (circularError) {
      throw new Error(circularError);
    }

    this.aliases = aliases;
    logger.info('Model aliases updated', { count: Object.keys(aliases).length });
  }

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
    const alias = this.aliases[normalizedName];

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
  getAliases(): ModelAliases {
    return { ...this.aliases };
  }

  /**
   * Check if a model name is an alias.
   *
   * @param modelName - The model name to check
   * @returns true if the model name is a known alias
   */
  isAlias(modelName: string): boolean {
    const normalized = modelName.toLowerCase().trim();
    return normalized in this.aliases;
  }
}

/**
 * Create a new ModelResolver instance.
 * For backward compatibility - creates resolver with empty aliases.
 *
 * @param options - Configuration options
 * @returns A new ModelResolver instance
 */
export function createModelResolver(options?: ModelResolverOptions): ModelResolver {
  return new ModelResolver(options);
}
import type { CodingPlan } from '@/types';
import { logger } from '@/utils/logger';

/**
 * Check if a plan supports a given model name, considering both direct matches
 * and plan-specific model aliases.
 * 
 * @param plan The coding plan to check
 * @param model The model name to search for
 * @returns true if the plan supports the model, false otherwise
 */
export function planSupportsModel(plan: CodingPlan, model: string): boolean {
  const normalizedModel = model.toLowerCase().trim();

  if (plan.models.some((m) => m.toLowerCase() === normalizedModel)) {
    return true;
  }

  if (plan.modelAliases) {
    for (const [alias, target] of Object.entries(plan.modelAliases)) {
      if (alias.toLowerCase() === normalizedModel) {
        const normalizedTarget = target.toLowerCase();
        if (plan.models.some((m) => m.toLowerCase() === normalizedTarget)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Resolve a requested model name to its canonical name defined in a plan.
 * If the model name matches an alias, returns the exact canonical name from the plan's models array.
 * If the model name matches a model directly, returns the exact name from the plan's models array.
 * 
 * @param plan The coding plan containing models and aliases
 * @param searchModel The model name requested by the user
 * @returns The canonical model name with the exact casing defined in the plan's models array
 */
export function resolveCanonicalName(plan: CodingPlan, searchModel: string): string {
  let canonicalName = searchModel;
  const normalizedSearch = searchModel.toLowerCase().trim();

  const exactDirectMatch = plan.models.find(
    (m) => m.toLowerCase() === normalizedSearch
  );

  if (exactDirectMatch) {
    canonicalName = exactDirectMatch;
  } else if (plan.modelAliases) {
    for (const [alias, target] of Object.entries(plan.modelAliases)) {
      if (alias.toLowerCase() === normalizedSearch) {
        const normalizedTarget = target.toLowerCase();
        const exactAliasTargetMatch = plan.models.find(
          (m) => m.toLowerCase() === normalizedTarget
        );
        if (exactAliasTargetMatch) {
          canonicalName = exactAliasTargetMatch;
        } else {
          // If alias target is not found in models array, log a warning and return original searchModel
          logger.warn('Model alias target not found in plan models during canonical name resolution', {
            planId: plan.id,
            alias,
            target,
            availableModels: plan.models
          });
        }
        break;
      }
    }
  }

  return canonicalName;
}

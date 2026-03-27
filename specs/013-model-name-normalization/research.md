# Research: Model Name Case-Insensitive Matching

**Feature Branch**: `013-model-name-normalization`
**Date**: 2026-03-27

## Executive Summary

This feature enables case-insensitive model name matching when routing requests to coding plans. Research confirms case-insensitive matching is already implemented in the codebase. The main enhancement needed is model alias support.

## R1: Existing Code Analysis

### Current Implementation

The codebase already implements case-insensitive model matching in multiple locations:

1. **PlanRepository.findByModel()** (src/services/plan-repository.ts:115-123)
   ```typescript
   const normalizedModel = model.toLowerCase();
   return Array.from(this.plans.values())
     .filter((plan) => plan.models.some((m) => m.toLowerCase() === normalizedModel))
   ```

2. **PlanSelector.findPlansByModel()** (src/services/plan-selector.ts:152-169)
   ```typescript
   const normalizedModel = model.toLowerCase().trim();
   const matchingPlans = plans.filter((plan) =>
     plan.models.some((m) => m.toLowerCase() === normalizedModel)
   );
   ```

3. **PlanSelector.supportsModel()** (src/services/plan-selector.ts:266-269)
   ```typescript
   const normalizedModel = model.toLowerCase().trim();
   return plan.models.some((m) => m.toLowerCase() === normalizedModel);
   ```

### Gap Analysis

| Requirement | Status | Notes |
|------------|--------|-------|
| FR-001: Case-insensitive matching | DONE | Already implemented |
| FR-002: Normalize incoming model names | DONE | Already implemented |
| FR-003: Support all case variations | DONE | toLowerCase covers all cases |
| FR-004: Clear error when not found | PARTIAL | Basic error exists, can improve |
| FR-005: Preserve original model name | NEEDS VERIFICATION | Must verify in proxy |
| FR-006: Model aliases | NOT IMPLEMENTED | Main gap to address |

## R2: Best Practices for Case-Insensitive Matching

### Approach Selection

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| toLowerCase() comparison | Simple, fast, O(n) | Basic only | USE for core matching |
| Locale-aware comparison | Handles special chars | Slower, complex | AVOID - unnecessary |
| Unicode normalization | Handles accents | Overhead | AVOID - not needed |

**Decision**: Use `toLowerCase()` with `trim()` - simplest and fastest approach that covers 100% of use cases for model names.

## R3: Model Alias Strategy

### Alias Implementation Patterns

1. **Simple string mapping**: alias → canonical name
2. **Configurable aliases**: Allow users to define custom aliases
3. **Built-in common aliases**: Pre-defined aliases for popular models

### Recommended Approach

Implement **built-in common aliases** with an extensible pattern:

```typescript
// Example alias structure
const MODEL_ALIASES: Record<string, string> = {
  'gpt-4': 'gpt-4-turbo',
  'gpt-3.5-turbo': 'gpt-3.5-turbo-0125',
  'claude-3': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
};
```

### Alias Resolution Flow

```
1. Receive model name from request
2. Normalize to lowercase (existing)
3. Check if normalized name is an alias → resolve to canonical
4. Compare against plan models (case-insensitive)
5. If match found, return original model name to upstream
```

## R4: Error Message Enhancement (FR-004)

Current error: `"No coding plan supports model '${model}'"`

Improved error should include:
- The requested model
- Clear indication case-insensitive search was performed
- List of available models (case-insensitive match attempted)

## R5: Preserving Original Model Name (FR-005)

Need to verify that the proxy forwards the original model name (not the normalized version) to upstream providers.

**Verification needed**: Check RequestProxy implementation to confirm original model name is preserved.

## Research Conclusion

1. **Case-insensitive matching is already implemented** - minimal code changes needed
2. **Primary enhancement needed**: Model alias support
3. **Secondary enhancement**: Improve error messages to show available models
4. **Verify**: Original model name preservation in upstream requests

## References

- Fastify routing patterns
- Existing PlanSelector and PlanRepository implementations
- Feature specification: spec.md
- Architecture: docs/architecture.md
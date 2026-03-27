# Data Model: Model Name Case-Insensitive Matching

**Feature Branch**: `013-model-name-normalization`
**Date**: 2026-03-27

## Entity Definitions

### ModelResolver

Central service for resolving model names with case-insensitive matching and alias support.

```typescript
/**
 * ModelResolver - Handles model name normalization and alias resolution.
 */
class ModelResolver {
  /**
   * Resolve a model name to its canonical form.
   * 1. Normalize input (trim, lowercase)
   * 2. Check if it's an alias → resolve to canonical
   * 3. Return canonical name for matching
   *
   * @param modelName - The model name from the request
   * @returns The canonical model name for plan matching
   */
  resolve(modelName: string): string;

  /**
   * Resolve to canonical name but preserve original for upstream.
   * Used when we need both canonical (for matching) and original (for forwarding).
   *
   * @param modelName - The model name from the request
   * @returns Resolution result with canonical and original names
   */
  resolveWithOriginal(modelName: string): ModelResolutionResult;
}
```

### ModelResolutionResult

```typescript
interface ModelResolutionResult {
  /** The normalized/canonical model name for matching against plan models */
  canonicalName: string;
  /** The original model name from the request (for upstream) */
  originalName: string;
  /** Whether the model was resolved from an alias */
  wasAlias: boolean;
  /** The alias if wasAlias is true, undefined otherwise */
  resolvedAlias?: string;
}
```

### Model Alias Map

Built-in constants for common model aliases.

```typescript
/**
 * Built-in model aliases for common naming variations.
 * Maps alias -> canonical model name.
 */
const MODEL_ALIASES: Record<string, string> = {
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
```

### GatewayError Enhancement

Enhanced error message for model not found.

```typescript
interface ModelNotFoundError {
  code: 'MODEL_NOT_FOUND';
  message: string;
  details: {
    requestedModel: string;
    searchedModel: string;  // The normalized/searched model name
    availableModels: string[];  // List of all available models (case-normalized)
    searchedAliases: string[];  // Aliases that were checked
    requestId: string;
  };
}
```

## Usage Flow

### Plan Matching Flow

```typescript
// Request: model = "gpt-4"
// Resolution: canonical = "gpt-4-turbo"

// In PlanSelector.findPlansByModel():
// 1. Receive "gpt-4-turbo" (canonical)
// 2. For each plan, check: plan.models includes "gpt-4-turbo" (case-insensitive)
// 3. Return matching plans

// When forwarding to upstream:
// Use original model name: "gpt-4"
```

### Error Scenario

```typescript
// Request: model = "unknown-model"
// Resolution: canonical = "unknown-model" (no alias)
// Search: No plan supports "unknown-model"
// Error response:
{
  error: {
    message: "Model 'unknown-model' not found. Case-insensitive search performed. Available models: gpt-4-turbo, claude-3-opus-20240229, ...",
    type: "invalid_request_error",
    code: "MODEL_NOT_FOUND"
  }
}
```

## Key Design Decisions

1. **No persistence needed**: Aliases are constants defined in code
2. **Canonical names stored in plans**: Plan configurations use canonical names
3. **Original name preserved**: Upstream requests use original model name from request
4. **Case-insensitive at match time**: Both alias resolution and plan matching use lowercase comparison

## TypeScript Interfaces Summary

| Interface/Type | Purpose |
|---------------|---------|
| `ModelResolver` | Main service for model name resolution |
| `ModelResolutionResult` | Result containing canonical and original names |
| `MODEL_ALIASES` | Constant map of alias -> canonical |
| `ModelNotFoundError` | Enhanced error with available models list |
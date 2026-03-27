# Data Model: Model Alias Configuration

## Overview

This document describes the data model changes required to support configurable model aliases in the Coding Plan Gateway.

## Config Schema

### Current State

```typescript
// Existing config schema (src/config/schema.ts)
export const configSchema = z.object({
  version: z.string().optional(),
  plans: z.array(planConfigSchema).default([]),
  loadBalancing: loadBalanceConfigSchema.optional(),
});
```

### New State

```typescript
// New model aliases schema
const modelAliasesSchema = z.record(
  z.string().min(1),  // alias key (e.g., "gpt-4")
  z.string().min(1)   // canonical model name (e.g., "gpt-4-turbo")
).default({});

// Updated config schema
export const configSchema = z.object({
  version: z.string().optional(),
  plans: z.array(planConfigSchema).default([]),
  loadBalancing: loadBalanceConfigSchema.optional(),
  modelAliases: modelAliasesSchema,  // NEW
});
```

## Config Type

```typescript
// Inferred types
export type ModelAliases = Record<string, string>;  // alias -> canonical

export type Config = z.infer<typeof configSchema>;
// Now includes: { plans: PlanConfig[], modelAliases: ModelAliases, ... }
```

## Example Configuration

```yaml
# config.yaml
version: "1.0"

# Model aliases - maps user-provided names to canonical names
modelAliases:
  # GPT series
  gpt-4: gpt-4-turbo
  gpt-4-32k: gpt-4-32k-context
  gpt-3.5-turbo: gpt-3.5-turbo-0125

  # Claude series
  claude-3: claude-3-opus-20240229
  claude-3-sonnet: claude-3-sonnet-20240229
  claude-3-haiku: claude-3-haiku-20240307

  # MiniMax series
  minimax-m2.5: MiniMax-M2.5
  minimax-m2: MiniMax-M2

plans:
  - id: 1
    name: "Ark Coding Plan"
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding"
    apiKey: "YOUR_API_KEY_HERE"
    models:
      - "ark-code-latest"
      - "MiniMax-M2.5"
    quota:
      limit: 90000
      period: "monthly"
    timeout: 180000
    status: "active"
```

## Validation Rules

| Rule | Description | Behavior |
|------|-------------|----------|
| Non-empty keys | Alias keys must be non-empty strings | Reject at parse time |
| Non-empty values | Canonical names must be non-empty | Reject at parse time |
| No circular references | Detect A→B→A chains | Fail at startup |
| No self-reference | Detect A→A | Fail at startup |

## State Transitions

### At Startup

```
config.yaml loaded
       ↓
Parse modelAliases (if present)
       ↓
Validate for circular references
       ↓
Pass to ModelResolver
       ↓
Start server
```

### On Hot Reload

```
config.yaml changed
       ↓
Reload configuration
       ↓
Parse new modelAliases
       ↓
Validate for circular references
       ↓
Replace aliases in ModelResolver
       ↓
Continue serving requests
```

## Backward Compatibility

If `modelAliases` is not present in config.yaml:
- Use empty alias map
- System behaves as before (no aliases applied)
- No error or warning logged (this is expected state)

If `modelAliases` is present but empty:
- Use empty alias map
- Same behavior as above

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      config.yaml                            │
├─────────────────────────────────────────────────────────────┤
│  version: "1.0"                                             │
│  modelAliases: { "minimax-m2.5": "MiniMax-M2.5", ... }    │
│  plans: [ ... ]                                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    loadConfig()
                           ↓
                       Config
                           ↓
              ┌────────────┴────────────┐
              ↓                         ↓
        ModelResolver            Request Router
        (stores aliases)         (resolves models)
              ↓
        resolveWithOriginal(modelName)
              ↓
        Returns { canonicalName, originalName, wasAlias }
```
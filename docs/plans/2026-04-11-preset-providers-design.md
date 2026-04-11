# Preset Providers Design

> Date: 2026-04-11
> Status: Approved

## Problem

Currently, each coding plan requires manual configuration of `baseUrl`, `models`, and `quota`. Users must know the correct API endpoint and available models for each provider. Some providers (e.g., Zhipu) expose usage query APIs, but the gateway ignores them — relying entirely on local request counting for quota management.

## Goals

1. Provide preset providers with default `baseUrl` and `models` — users only supply `apiKey`
2. For providers with usage APIs, use real-time API queries for quota determination instead of local counting
3. Keep local tracking for statistics only when usage API is available
4. Extensible: adding new providers or usage APIs should require minimal code changes

## Scope

**Phase 1 providers:**

| Provider | baseUrl | Models | Usage API |
|---|---|---|---|
| Zhipu | `https://open.bigmodel.cn/api/anthropic` | `glm-5.1`, `glm-5-turbo` (alias: `glm-5`) | Yes |
| Volcengine | `https://ark.cn-beijing.volces.com/api/coding` | `ark-code-latest`, `doubao-seed-2.0-code`, `kimi-k2.5`, `minimax-m2.5`, `glm-4.7` | No |
| Ali | `https://coding.dashscope.aliyuncs.com/apps/anthropic` | `qwen3.5-plus`, `glm-5`, `glm-4.7`, `kimi-k2.5`, `MiniMax-M2.5` | No |

Moonshot deferred to future phase.

## Architecture: Provider Registry + Usage Adapter

### Provider Registry

Built-in presets in code, overridable via `config.yaml`.

```typescript
// src/types/provider.ts

interface ProviderPreset {
  id: string;                              // 'zhipu' | 'volcengine' | 'ali'
  name: string;                            // Display name
  baseUrl: string;                         // Default API endpoint
  models: string[];                        // Available models
  defaultModelAliases?: Record<string, string>;  // e.g., { 'glm-5': 'glm-5-turbo' }
  hasUsageApi: boolean;                    // Whether provider has usage query API
}
```

**Built-in defaults** (`src/config/builtin-providers.ts`):

```typescript
const BUILTIN_PROVIDERS: ProviderPreset[] = [
  {
    id: 'zhipu',
    name: 'Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.1', 'glm-5-turbo'],
    defaultModelAliases: { 'glm-5': 'glm-5-turbo' },
    hasUsageApi: true,
  },
  {
    id: 'volcengine',
    name: 'Volcengine / Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    models: ['ark-code-latest', 'doubao-seed-2.0-code', 'kimi-k2.5', 'minimax-m2.5', 'glm-4.7'],
    hasUsageApi: false,
  },
  {
    id: 'ali',
    name: 'Ali / DashScope',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    models: ['qwen3.5-plus', 'glm-5', 'glm-4.7', 'kimi-k2.5', 'MiniMax-M2.5'],
    hasUsageApi: false,
  },
];
```

**Config override** (`config.yaml`):

```yaml
providers:
  zhipu:
    baseUrl: https://custom-proxy.example.com   # Override default baseUrl
    models:
      - glm-5.1
      - glm-5-turbo
  my-custom-provider:                           # Add new provider
    name: My Custom Provider
    baseUrl: https://api.example.com/v1
    models: [model-a, model-b]
    hasUsageApi: false
```

Loading: built-in presets → config overrides merge → final registry.

### Usage Adapter

```typescript
// src/types/usage-adapter.ts

interface UsageResult {
  used: number;        // Used quota
  limit: number;       // Total quota
  percentage: number;  // Usage percentage (0-100)
  expiresAt?: string;  // Period end time
  raw?: unknown;       // Raw API response for debugging
}

interface UsageAdapter {
  readonly providerId: string;
  readonly cacheTTL: number;  // Cache duration in seconds

  queryUsage(apiKey: string): Promise<UsageResult>;
}
```

**Zhipu adapter** (`src/services/usage-adapters/zhipu-adapter.ts`):

Based on `glm-usage.sh` logic, calls:

```
GET {baseDomain}/api/monitor/usage/quota/limit
Authorization: {apiKey}

Response: {
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', percentage: 45.2 },  // 5h window
      { type: 'TOKENS_LIMIT', percentage: 30.1 },  // weekly window
    ]
  }
}
```

Parses all `TOKENS_LIMIT` percentages — any exceeding 100% means quota exhausted.

**Cache layer** (`src/services/usage-adapters/cached-adapter.ts`):

Wraps any `UsageAdapter` with in-memory TTL cache (default 5 minutes). Keyed by provider ID.

### Plan Schema Changes

```typescript
// PlanConfig new field:
{
  provider?: string;  // Provider ID referencing the registry
                      // When set: baseUrl/models become optional (use preset defaults)
}
```

**Validation rules:**

| Condition | Rule |
|---|---|
| `provider` set + `hasUsageApi: true` | `quota` field forbidden (managed by usage API). No `expiresOn`/`expiresAt` needed. |
| `provider` set + `hasUsageApi: false` | `quota` required (same as current logic). |
| `provider` not set | All current rules unchanged (`baseUrl`, `models`, `quota` all required). |
| `provider` set + `baseUrl` provided | User value overrides preset. |
| `provider` set + `models` provided | User value overrides preset. |

**Config YAML examples:**

```yaml
plans:
  # With usage API — no quota needed
  - name: My Zhipu Plan
    provider: zhipu
    apiKey: enc:xxx
    # baseUrl: omitted → preset default
    # models: omitted → preset default
    # quota: omitted → managed by Zhipu usage API

  # Without usage API — quota required
  - name: My Volcengine Plan
    provider: volcengine
    apiKey: enc:xxx
    quota:
      limit: 90000
      period: { type: 'monthly', expiresOn: 1 }

  # No provider — fully manual (backward compatible)
  - name: Custom Plan
    baseUrl: https://api.example.com/v1
    apiKey: enc:xxx
    models: [model-a]
    quota:
      limit: 1000
      period: { type: '5h' }
```

### QuotaManager Integration

Modified `hasRemainingQuota()` flow:

```
hasRemainingQuota(planId):
  if plan.provider && registry[plan.provider].hasUsageApi:
    adapter = registry.getUsageAdapter(plan.provider)
    usage = await adapter.queryUsage(plan.apiKey)  // cached
    return usage.percentage < 100
  else:
    return existing local counting logic
```

Local `PlanUsageTracker` always records statistics regardless of provider type.

### Error Handling

| Scenario | Behavior |
|---|---|
| Usage API timeout/failure | Fallback: use cached data (even if expired). No cache → treat as quota available (prefer over-blocking) |
| Usage API returns malformed data | Log warning, treat as quota available |
| Cache miss + API unavailable | Skip quota check, route normally |
| Local stats recording failure | Log error, does not affect routing |

### Request Routing Flow

```
Request → Router.route(model)
  → Find matching plans
  → For each candidate plan:
      if provider.hasUsageApi:
        → UsageAdapter.queryUsage(apiKey)  // with cache
        → percentage >= 100%? Mark exhausted, skip
      else:
        → QuotaManager.hasRemainingQuota()  // existing local logic
  → PlanSelector picks best available plan
  → Proxy request
  → Always record local stats (PlanUsageTracker)
```

## Files to Create/Modify

### New files
- `src/types/provider.ts` — ProviderPreset interface
- `src/types/usage-adapter.ts` — UsageAdapter/UsageResult interfaces
- `src/config/builtin-providers.ts` — Built-in provider presets
- `src/services/usage-adapters/zhipu-adapter.ts` — Zhipu usage API adapter
- `src/services/usage-adapters/cached-adapter.ts` — Cache wrapper
- Tests for all new files

### Modified files
- `src/config/schema.ts` — Add `provider` field to PlanConfig schema, add `providers` section to root config schema
- `src/config/index.ts` — Load and merge provider presets with config overrides
- `src/types/coding-plan.ts` — Add `provider` field to CodingPlan type
- `src/services/quota-manager.ts` — Integrate usage adapter for quota checks
- `src/services/request-router.ts` — Handle async quota checks for API-based plans
- `src/services/plan-repository.ts` — Apply preset defaults when provider is specified
- `src/routes/admin/handlers.ts` — Update plan CRUD validation to respect provider rules
- `config.yaml.example` — Add providers section and provider-based plan examples

## Backward Compatibility

- Existing plans without `provider` field work identically (fully manual configuration)
- `config.yaml` without `providers` section works identically
- No breaking changes to existing API contracts

# Coding Plan Gateway - Project Context

> This file provides essential context for AI agents working on this project.

## Project Overview

**Coding Plan Gateway** - A load balancer for managing multiple AI coding plan subscriptions. Routes requests to appropriate providers based on model availability and quota, exposing OpenAI and Anthropic compatible APIs.

## Technology Stack

- **Runtime**: Node.js 20+ LTS
- **Framework**: Fastify 4.x
- **Language**: TypeScript 5.x
- **Testing**: Vitest
- **Deployment**: Docker, local

## Key Architecture Decisions

- Monolithic single-process architecture
- File-based configuration storage (YAML) with versioned auto-migration on startup
- In-memory quota tracking with periodic persistence
- Dual API format support (OpenAI + Anthropic)
- Quota-based load balancing
- Provider preset system: built-in defaults (Zhipu, Volcengine, Ali, DeepSeek, Kimi, NVIDIA) with config overrides and usage API adapters; NVIDIA is OpenAI-only (`baseUrl: ''` sentinel) and uses `dynamicModels`; Kimi For Coding serves both formats from `api.kimi.com/coding/v1` (coding-plan `sk-kimi-` keys only — public `api.moonshot.*` rejects them) and queries usage from `/coding/v1/usages`
- Dynamic model providers: custom providers (e.g. local LM Studio) fetch `/v1/models` at runtime (`dynamicModels`); `baseUrl` is optional — omit it for OpenAI-only upstreams (Anthropic `/v1/messages` skips them) or set both `baseUrl` + `openaiBaseUrl` when the upstream serves both formats (LM Studio does)
- Read-only web monitoring dashboard at `GET /dashboard` (zero-build single-page HTML, no external assets) backed by JSON endpoints under `/api/dashboard/*`. The `DashboardMetrics` singleton (fed by the log listener) tracks **in-flight requests** (`activeRequests`, from the `Request started`/`Request authenticated` pair until the completion log; the pending map is bounded at 500 pending, and stale pendings >30min are swept both at snapshot time and on a 60s unref'd timer via `startStaleSweep()`). Proxy URLs are matched by **path suffix after stripping the query string** (`stripQuery` + `endsWith`), so prefixed mounts (`/api/v1/messages`) and client query strings (`?beta=true`) both register; `/messages/count_tokens` stays excluded. Active rows also carry the **requested model**, picked up from the handlers' `Chat completion request`/`Anthropic message request` info logs. A bounded **recent-requests** buffer (200 rows, newest first) plus per-key/model/plan token counters feed the table-first panels: in-flight requests (elapsed ticking every second), per-API-key / per-model / per-plan token usage (current run merged with persisted history), a **plan balance panel** that only lists plans with an authoritative quota signal — ordered balances first (DeepSeek), then usage-API windows (Zhipu/Kimi, with fetch timestamps), then local-quota plans (reset schedule only — no remaining figure or progress bar, since the local counter is a self-imposed cap, not the provider's balance); plans with none of these are omitted, never guessed. Quota windows carry `nextResetTime` + a label-derived `durationMs` (`windowDurationMs`), and each quota window / local-quota row renders a **cycle time axis** (fill → 100% as the reset approaches) alongside the reset timestamp; local-quota rows carry `periodType`/`windowHours` so their cycle length is known. `/api/dashboard/summary` also exposes `activeDiagnostics {starts, auths, completions, pendingNow, pendingProxy}` for tracing the in-flight log pipeline without docker-log access (`pendingProxy` counts only pendings bound for the proxy endpoints). The whole dashboard surface (page + `/api/dashboard/*` data endpoints) is **auth-exempt by default** — it is read-only and exposes only aggregated metrics (no secrets, no mutations); operators can lock it back down via `AUTH_EXEMPT_PATHS`. Historical token statistics are **persisted** by `UsageStatsStore` (`src/services/usage-stats-store.ts`), which aggregates per `(date, planId, model)` counters to `./data/usage-stats.json` (override via `USAGE_STATS_PATH`, 90-day retention, recorded in the onResponse hook and persisted every 60s + on shutdown); the dashboard surfaces them via `/api/dashboard/stats` and a history panel (daily bars + per-plan/model totals), so token stats survive restarts unlike the in-memory counters.
- Two orthogonal routing layers: (1) **load balancing** picks WHICH plan serves a given model (plan-level, `loadBalancing` config); (2) **model routing** rewrites WHICH model a request uses based on request content, running as a pre-routing step inside the handlers BEFORE `RequestRouter.route` (`modelRouting` config). Model routing is a pluggable strategy framework (`ModelRoutingService` + `ModelRoutingStrategy`); the built-in `context-downgrade` strategy rewrites a model to a smaller-context variant when the estimated input fits (e.g. `k3` → `k3-256k`). The plan-selection pipeline stays model-name-keyed and unchanged; only the model name fed into it may be rewritten. Response `model` echoes the effective (served) model.

## Config Version Management

Config files are **automatically migrated** on startup. When a config file with an older version is loaded, the system creates a backup (`config.yaml.v{N}.bak`) and applies all pending migrations sequentially before proceeding.

**Key constants:**

| Constant | File | Current Value |
|----------|------|---------------|
| `LATEST_CONFIG_VERSION` | `src/config/defaults.ts` | `2` |

**Migration chain:** `src/config/migrations/registry.ts` — ordered array of `ConfigMigration` objects.

**How it works:**

1. `loadConfig()` calls `migrateConfigFile()` (`src/config/migrations/index.ts`)
2. `detectConfigVersion()` reads the `version` field (missing → `0`, `"1.0"` → `1`)
3. If version < `LATEST_CONFIG_VERSION`, backs up the file and runs all applicable migrations
4. Each migration transforms raw JS objects and sets the target `version` field

**When adding a breaking config change:**

1. Increment `LATEST_CONFIG_VERSION` in `src/config/defaults.ts`
2. Create migration file: `src/config/migrations/v{N}-to-v{N+1}.ts`
3. Implement `ConfigMigration` interface (must be idempotent, no side effects)
4. Register in `src/config/migrations/registry.ts` (append to array)
5. Update `configSchema` in `src/config/schema.ts` for the new format
6. Update `config.yaml.example`

**Current migrations:**

| Migration | File | Description |
|-----------|------|-------------|
| v0 → v1 | `src/config/migrations/v0-to-v1.ts` | String quota periods → structured objects, UUID IDs → integer IDs |
| v1 → v2 | `src/config/migrations/v1-to-v2.ts` | Remove deprecated `apiFormat` field from plans |

## Quick Reference

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions | camelCase, verb-first | `calculateQuota` |
| Variables | camelCase | `requestCount` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Classes/Types | PascalCase | `QuotaManager` |
| Interfaces | PascalCase (no I prefix) | `CodingPlan` |
| Files | kebab-case.ts | `quota-manager.ts` |
| Test files | *.test.ts | `quota-manager.test.ts` |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/messages` | POST | Anthropic-compatible messages |
| `/v1/models` | GET | List available models |
| `/api/plans` | CRUD | Manage coding plans |
| `/dashboard` | GET | Read-only web monitoring dashboard |
| `/api/dashboard/summary` | GET | Counters + in-flight/recent requests + per-key/model/plan usage + plan quota rows |
| `/api/dashboard/errors` | GET | Recent upstream/gateway errors for the dashboard |
| `/api/dashboard/stats` | GET | Persisted per-day/plan/model token stats (survives restarts) |
| `/health` | GET | Health check |

### Code Style

- **Indent**: 2 spaces
- **Line length**: 100 chars max
- **Semicolons**: Required
- **Quotes**: Single
- **Strict TypeScript**: Enabled

### Commit Convention

Follow Conventional Commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

### Git Merge Rules

**ALWAYS use `--no-ff` (no fast-forward) for merging feature branches.**

```bash
git checkout master
git merge <branch-name> --no-ff -m "merge: branch <branch-name> into master"
```

**Why `--no-ff`:**

| Aspect | `--no-ff` (Required) | `--squash` (Avoid) |
|--------|---------------------|-------------------|
| Commit type | Merge commit (2 parents) | Regular commit (1 parent) |
| Branch history | Preserved in git graph | Lost |
| Revertability | Easy to revert entire feature | Difficult |
| Traceability | Clear feature boundaries | No feature context |

**Benefits of `--no-ff`:**
- Branch appears as separate line in git graph
- All feature commits remain grouped
- Easy to identify which commits belong to which feature
- Can revert entire feature with one command: `git revert -m 1 <merge-commit>`

## Documentation References

- **Standards**: `docs/standards.md` - Complete coding standards
- **Architecture**: `docs/architecture.md` - System design decisions
- **Ground-rules**: `memory/ground-rules.md` - Project principles
- **Specification**: `specs/001-coding-plan-gateway/spec.md` - Feature requirements

## Development Workflow

1. Create feature branch from `main`
2. Write tests first (TDD encouraged)
3. Implement with standards compliance
4. Run lint, type-check, tests
5. Update CLAUDE.md if the branch introduces new architecture, config changes, or technology additions
6. Create PR with conventional commit style
7. Merge after review approval

## PR Review Requirements

### CLAUDE.md Update Check

Every feature branch **must** update `CLAUDE.md` before merge. Reviewers must verify the following sections are current:

| Section | When to update |
|---------|---------------|
| Key Architecture Decisions | New architectural patterns or subsystems added |
| Config Version Management | `LATEST_CONFIG_VERSION` changes or new migrations added |
| Active Technologies | New runtime dependencies or storage mechanisms introduced |
| Recent Changes | Any merged feature |

### Config Change Review

PRs that modify `config.yaml.example`, `src/config/schema.ts`, or the plan config structure **must** be reviewed against the config migration system:

1. **Version bump required** — If the change breaks backward compatibility (new required fields, renamed fields, removed fields), `LATEST_CONFIG_VERSION` in `src/config/defaults.ts` must be incremented
2. **Migration required** — A new `src/config/migrations/v{N}-to-v{N+1}.ts` file must be created to upgrade existing configs, implementing the `ConfigMigration` interface
3. **Registry update required** — The new migration must be appended to the `migrations` array in `src/config/migrations/registry.ts`
4. **Additive-only changes** — If the change only adds optional fields (e.g., a new `provider` field with sensible defaults), no version bump or migration is needed — the existing schema and `normalizePlanConfig()` handle graceful backward compatibility

## Security Requirements

- Validate ALL inputs at boundaries
- Encrypt API keys at rest (AES-256)
- Never log or commit secrets
- Use environment variables for sensitive config
- **CRITICAL: NEVER commit API keys or secrets to git**
  - `config.yaml` is in `.gitignore` for this reason
  - Always use placeholder values like `YOUR_API_KEY_HERE` in example files
  - If API keys are accidentally committed, rotate them immediately and use `git filter-repo` or BFG to remove from history

## Testing Requirements

- Unit test coverage: 80% minimum
- AAA pattern (Arrange-Act-Assert)
- Tests must be independent and isolated
- Critical paths require 100% coverage

## Active Technologies

- **Core**: TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x
- **Validation**: Zod (config + API schemas)
- **Testing**: Vitest (unit), Docker Compose (E2E), MSW (HTTP mocking)
- **CLI**: Commander.js
- **Security**: bcrypt (key hashing), AES-256 (API key encryption at rest)
- **Config**: YAML file-based with versioned auto-migration, environment variable expansion
- **Storage**: YAML/JSON files (config, state), in-memory (quota, RPM, timing)
- **Deployment**: Docker, Docker Compose v2
- **Future**: PostgreSQL with Drizzle ORM (migration path prepared)

## Recent Changes
- fix/web-dashboard: In-flight panel permanently empty in production — root cause: the proxy URL matcher required `/messages` at the URL END, but prod serves under a versioned prefix (`/api/v1/messages`) and clients append `?beta=true`. Now matched by path suffix after query stripping; `count_tokens` stays excluded. Active rows gained a **model column** (attached from the handlers' `Chat completion request`/`Anthropic message request` logs), diagnostics gained `pendingProxy`, and stale pendings are also swept on a 60s unref'd timer (`startStaleSweep()`, stopped on shutdown) instead of only at snapshot time. Quota panel: every usage-API window and every schedulable local-quota row now shows its **reset time with a cycle time axis** (fill → 100% as reset nears); window cycle length comes from `windowDurationMs(label)` (5h/1w/…), local rows carry `periodType`/`windowHours`. deploy.sh update check resolves the freshest ref (FETCH_HEAD → origin/master) so a failed fetch no longer aborts when the local ref is already current from this machine's own push.
- fix/web-dashboard: Visual refresh (tinted-neutral dark palette, 8px grid, tabular-nums, Operate-mode hierarchy per the Taste/Impeccable design frameworks) and three quota-panel adjustments: rows ordered balances first (DeepSeek) → usage-API windows by consumption → local-quota plans; every row shows its refresh/fetch timestamp; local-quota rows show only the cycle reset time (no remaining figure or progress bar). In-flight tracking hardened: stale pendings (>30min, e.g. lost completions from client disconnects) are swept at snapshot time, and `/api/dashboard/summary` exposes `activeDiagnostics {starts, auths, completions, pendingNow}` for pipeline debugging. `deploy.sh` fixed: a failed `git fetch` no longer aborts when origin/master is already ahead of HEAD, and rollback no longer resets git HEAD (image tag restore is the rollback) — removing the need to hand-patch the script on the router.
- refactor/web-dashboard: Rebuilt the dashboard around accuracy, dropping the sankey flow diagram (unreadable in practice). `DashboardMetrics` now exposes `activeRequests` (in-flight proxy requests tracked from the `Request started`/`Request authenticated` logs until completion; the pending map is bounded at 500 with oldest-first eviction) and a 200-row `recentRequests` buffer replacing `flows`. `/api/dashboard/flows` is **removed**; `/api/dashboard/summary` now returns `activeRequests`, `recentRequests`, `apiKeyUsages` and `planQuotas` (built by `buildPlanQuotaRows()`): only plans with an authoritative remaining signal get a row — usage-API windows, account balance, or finite local quota (limit > 0, remaining = limit − used); other plans are omitted. The page is now table-first: in-flight requests with a per-second ticking elapsed column, per-key/model/plan token leaderboards (current run merged with persisted `/stats` history), plan balance cards, recent-requests table, recent-errors panel.
- feat/web-dashboard: Read-only web monitoring dashboard. `GET /dashboard` serves a zero-build self-contained HTML page (vanilla JS sankey renderer, no CDN/build step); JSON endpoints `/api/dashboard/{flows,summary,errors}` feed it. `DashboardMetrics` now aggregates a bounded `flows` buffer of request chains (`apiKey → model → plan → canonicalModel`, tokens, duration, status) consumed by the flow diagram (edge width = token volume, dashed edges = failures), alongside quota bars and a recent-errors panel. The page path is added to default `authExemptPaths` (shell only — data endpoints stay authenticated). Supporting logging fixes: auth middleware now emits `Request authenticated` at info level (was debug, so key attribution vanished at default log level), and the global error handler includes `providerMetrics` on `Request error` entries.
- fix/token-estimator: `TokenCounter.estimateAnthropicInputTokens`/`estimateOpenAIInputTokens` now count `tool_use`/`tool_result` blocks, OpenAI `tool_calls`, and `tools` definitions (previously silently skipped — tool_result bodies dominate agentic traffic, causing ~60x underestimates). Structured payloads are counted via JSON serialization with recursive text extraction; verified against Kimi upstream real counts (342 estimated vs 432 real for a tool_result payload, was 7).
- feat/model-routing: Added a content-aware **model routing** layer (orthogonal to plan-level load balancing). A pluggable `ModelRoutingService` + `ModelRoutingStrategy` framework (`src/services/model-router.ts`, `src/types/model-routing.ts`) rewrites the requested model before plan selection, configured under a top-level `modelRouting` key (additive — no config version bump). First strategy `context-downgrade` rewrites to a smaller-context variant when the estimated input fits (e.g. `k3` → `k3-256k` at ≤ `when.inputTokensLte`); token estimation runs only when a rule's `from` matches. Wired into `createChatCompletion`/`createMessage` (not `count_tokens`); response echoes the effective model. Added `k3-256k` to `MODEL_INFO`.
  - Reactive model fallback: because the local tokenizer estimate undercounts Kimi K3's real context, a rewrite can be rejected by the upstream (e.g. `k3-256k` → 401 "supports only 256K context"). When a rewritten-model attempt fails (pre-header), the handler retries once on the original requested model (`k3`); mid-stream failures are not retried. This makes the feature safe regardless of estimator accuracy. The local-estimate caveat is recorded in memory.
- feat/kimi-provider: Added Kimi For Coding as a built-in preset (`api.kimi.com/coding/v1` for both formats, `dynamicModels`, `hasUsageApi`). `KimiUsageAdapter` queries `/coding/v1/usages` (approach adapted from cc-switch): rolling 5h windows from `limits[].detail` + weekly quota from `usage`, numeric fields arrive as strings, overall percentage = max across windows. Model metadata added to `MODEL_INFO`.
- feat/nvidia-provider: Added NVIDIA / NIM as a built-in OpenAI-only preset (`integrate.api.nvidia.com/v1`, `dynamicModels`, `baseUrl: ''`). Serves OpenAI clients only; Anthropic clients require an external converter — see `docs/` or the preset comment in `src/config/builtin-providers.ts`. No in-gateway format conversion (deliberate: no reliable maintained Node library exists; conversion is external per the chosen design).
- feat/dynamic-providers: Custom OpenAI-only providers with runtime model fetching (`dynamicModels`, `modelsExclude`), `ModelSyncService` (startup + `MODEL_SYNC_INTERVAL_MS` refresh, in-memory only), optional `baseUrl` (Anthropic routing skips OpenAI-only plans); custom-provider field defaults now flow through `normalizePlanConfig`
- feat/preset-providers: Added built-in provider presets (Zhipu, Volcengine, Ali), usage adapter system (Zhipu API), ProviderRegistry, `provider` field on plans
- config-migration: Added versioned config migration system (v0→v1: quota period + UUID-to-int ID migration)

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
- **Anthropic payload sanitation** (`normalizeRequest` in `src/routes/anthropic/handlers.ts`, runs pre-routing on every `/v1/messages`): keeps upstreams receiving spec-shaped bodies without converting formats. Two normalizations: (1) `output_config.effort` "xhigh" → "max"; (2) `role:"system"` messages embedded in `messages[]` are hoisted into the top-level `system` field (top-level content first, then hoisted content in encounter order; no-op for all-system bodies). Rationale: the Anthropic spec reserves `user`/`assistant` for `messages` — loose clients embed system anyway, and upstreams fail in two ways (strict APIs 400; LM Studio accepts then 500s at chat-template render with "System message must be at the beginning" when the system message is not at index 0 — Qwen-family templates raise this). Spec-shaped requests pass through untouched (string `system` stays a string). Diagnostics: `CPG_LOG_REQUEST_BODY_ON_ERROR=1` makes `request-proxy.ts` log a 2000-char request-body preview whenever an upstream returns 4xx/5xx (non-streaming and pre-first-chunk streaming paths) — off by default because bodies carry user content.
- Read-only web monitoring dashboard at `GET /dashboard` (zero-build single-page HTML, no external assets) backed by JSON endpoints under `/api/dashboard/*`. The `DashboardMetrics` singleton (fed by the log listener) tracks **in-flight requests** (`activeRequests`, from the `Request started`/`Request authenticated` pair until the completion log; the pending map is bounded at 500 pending, and stale pendings >30min are swept both at snapshot time and on a 60s unref'd timer via `startStaleSweep()`). Proxy URLs are matched by **path suffix after stripping the query string** (`stripQuery` + `endsWith`), so prefixed mounts (`/api/v1/messages`) and client query strings (`?beta=true`) both register; `/messages/count_tokens` stays excluded. Active rows also carry the **requested model**, picked up from the handlers' `Chat completion request`/`Anthropic message request` info logs. A bounded **recent-requests** buffer (200 rows, newest first) plus per-key/model/plan token counters feed the table-first panels: in-flight requests (elapsed ticking every second), per-API-key / per-model / per-plan token usage (current run merged with persisted history), a **plan balance panel** that only lists plans with an authoritative quota signal — ordered balances first (DeepSeek), then usage-API windows (Zhipu/Kimi, with fetch timestamps), then local-quota plans (reset schedule only — no remaining figure or progress bar, since the local counter is a self-imposed cap, not the provider's balance); plans with none of these are omitted, never guessed. Quota windows carry `nextResetTime` + a label-derived `durationMs` (`windowDurationMs`), and each quota window / local-quota row renders a **cycle time axis** (fill → 100% as the reset approaches) alongside the reset timestamp; local-quota rows carry `periodType`/`windowHours` so their cycle length is known. `/api/dashboard/summary` also exposes `activeDiagnostics {starts, auths, completions, pendingNow, pendingProxy}` for tracing the in-flight log pipeline without docker-log access (`pendingProxy` counts only pendings bound for the proxy endpoints). The whole dashboard surface (page + `/api/dashboard/*` data endpoints) is **auth-exempt by default** — it is read-only and exposes only aggregated metrics (no secrets, no mutations); operators can lock it back down via `AUTH_EXEMPT_PATHS`. Historical token statistics are **persisted** by `UsageStatsStore` (`src/services/usage-stats-store.ts`), which aggregates per `(date, planId, model)` counters to `./data/usage-stats.json` (override via `USAGE_STATS_PATH`, 90-day retention, recorded in the onResponse hook and persisted every 60s + on shutdown); the dashboard surfaces them via `/api/dashboard/stats` and a history panel (daily bars + per-plan/model totals), so token stats survive restarts unlike the in-memory counters. **Balance history for balance-type plans** (adapters returning `summary.mode === 'balance'`, e.g. DeepSeek) is likewise persisted: `BalanceHistoryStore` (`src/services/balance-history-store.ts`) folds every numeric balance sample from the 60s usage poller (adapters expose `summary.numericValue` + `summary.currency` alongside the display string) into **hourly OHLC candles** keyed `planKey:hourStartMs` in `./data/balance-history.json` (override via `BALANCE_HISTORY_PATH`, 90-day retention, module-level singleton registry for the read-only routes, persisted every 60s + on shutdown); `/api/dashboard/balance-history?hours=N` returns per-plan candle series, and the dashboard renders them as a **mini candlestick sparkline inside each balance quota card** (last 48 activity candles; click opens the「余额历史 · 1h K线」**modal** — Esc/backdrop/✕ close it) with the full hand-rolled SVG chart: **红涨绿跌** candles (Chinese market convention: red = balance rose/top-up, green = spent) plus a faint close-price polyline and a hover inspector with OHLC and delta. **Flat periods are folded away**: `filterActiveCandles()` drops candles that are flat (h === l) and sit at the previous kept close (first/last anchors and flat candles at a new level stay), and the remaining candles are packed by index so unchanged stretches don't occupy dead space; the modal guarantees visible x-axis time labels (per-candle date+hour when sparse, day boundaries when dense, 6h-hour/first+last fallbacks) over a bottom axis line. The chart refreshes only while the modal is open (hidden containers report clientWidth 0).
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
| `/api/dashboard/balance-history` | GET | Persisted hourly OHLC balance candles for balance-type plans (`hours` window) |
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
- fix/anthropic-system-normalize: **Anthropic 请求规范化 + 错误请求体诊断**。`normalizeRequest`（`src/routes/anthropic/handlers.ts`，`/v1/messages` 预路由阶段）新增第二条规范化：把 `messages[]` 里内嵌的 `role:"system"` 消息提升合并进顶层 `system`（先顶层内容、后按出现顺序，统一为 blocks；规范形态的请求原样透传，全 system 的 body 不动）。动因：2026-09-03 lms 计划（LM Studio @ .146）事故——Anthropic 规范本不允许 messages 里出现 system，宽松客户端仍会发；严格上游直接 400，而 LM Studio 接受后在聊天模板渲染期 500（Qwen 系模板 `System message must be at the beginning`，system 不在 index 0 即抛）。`{messages:[user, system]}` 形态经 prod 网关实测复现同一 500，提升后返回正常补全。附带 `CPG_LOG_REQUEST_BODY_ON_ERROR=1`（`request-proxy.ts`）：上游 4xx/5xx 时在非流式与流式 pre-first-chunk 两条错误路径记录 2000 字符截断请求体（默认关闭，body 含用户内容）——事发时 payload 不可考，开启后复发即可从 prod 日志定位。测试：handlers 4 例 + proxy 3 例（真实 socket 上游）。
- feat/balance-mini-fullwidth: **余额卡片迷你 K线改为通栏无框条带**。不再挤在余额数字右侧（140px 固定宽、带边框深底），改为占满卡片全宽的 44px 高透明条带：无边框无坐标轴、hover 才有淡色衬底，与卡片自然融合。两阶段渲染：`balMiniHtml()` 只输出按钮壳（含 HTML 颗粒度浮标 `q-mini-gran`），`fillBalMinis()` 在卡片插入 DOM 后按按钮**实测像素宽度**调 `balMiniSvg(p, w, 44)` 重绘——不用 preserveAspectRatio 拉伸，蜡烛/折线/文字零失真，且随 5s 轮询自动适配布局变化。面积填充、最新收盘虚线参考线、涨跌端点圆点保留。
- fix/balance-chart-scrollbar: K线弹层图表下方不再出现横向滚动条：`.bal-scroll` 隐藏滚动条视觉（`scrollbar-width: none` + `::-webkit-scrollbar` 隐藏，极端密度下仍可滑动），innerW 多留 2px 余量、plotW 向下取整，消除 toFixed 进位与纵向滚动条晚出现导致的亚像素溢出。
- feat/balance-candle-granularity: **余额 K线颗粒度切换（1h/12h/1d）+ 迷你图视觉增强**。弹层新增颗粒度按钮组（1h/12h/1d，与范围 24h/3天/7天/30天/**90天** 用分隔线分组）：`aggregateCandles()` 把 1h 原始 K线按**本地时区**折叠成 12h 半天（00:00/12:00 对齐）或日历日桶（开=首根开、收=末根收、高/低=极值、n=采样数求和），纯客户端聚合无需重新请求，选择经 `localStorage(cpg_dash_bal_gran)` 持久化且卡片迷你图跟随同一颗粒度。弹层标题随颗粒度动态更新（#bmTitle），悬停检查条按桶跨度显示（1d 为"全天"，12h 为起止时刻），x 轴在 1d 下标注纯日期。**迷你 sparkline 增强**：收盘价折线下加淡色面积填充、最新收盘价虚线参考线 + 按涨跌着色的端点圆点、左上角颗粒度微标，title 提示当前颗粒度与有效 K线数。修复范围按钮 active 态的重复 class 属性问题。无后端/存储变更。
- feat/balance-mini-candles: **余额 K线交互重构**。常驻的「余额历史 · 1h K线」面板改为：每个余额型 plan 的「Plan 余量 / 余额」卡片内嵌**迷你 K线 sparkline**（近 48 根有效蜡烛，无历史时不显示），点击弹出完整 K线**弹层**（Esc / 背板 / ✕ 关闭；范围切换 24h/3天/7天/30天 与悬停检查条保留；弹层关闭时 5s 轮询不再重建 SVG）。**过滤无变化时段**：`filterActiveCandles()` 折叠"平坦且与前一保留收盘同价"的 K线（首尾锚点与台阶式跳变保留），其余按索引压缩排布，无变化的小时不再占用画面；卡片副标题显示折叠数。**X轴坐标始终可见**：稀疏图（槽宽≥44px）每根 K线标注"月-日 时:00"，密集图标注日边界"月-日"，同日回退 6 小时刻度，最后兜底首尾两根；并补底部轴线。**颜色改为红涨绿跌**（蜡烛/迷你图/图例/悬停变动/头部涨跌全部同步：up=`--err` 红、down=`--ok` 绿）。无后端/存储变更。
- feat/balance-history-candles: **余额型 Plan 的历史余额记录 + 仪表盘 1h K线图**。`UsageSummary` 增加可选 `numericValue`/`currency`（DeepSeek 适配器从 `total_balance` 解析填充），60s 用量轮询器 `refreshQuotaData()` 对余额型 plan 把每个数值采样交给新服务 `BalanceHistoryStore`（`src/services/balance-history-store.ts`）：按 `planKey:小时桶` 聚合为 OHLC K线（首采样为开、末采样为收、极值为高/低），原子写 `./data/balance-history.json`（`BALANCE_HISTORY_PATH` 覆盖，90 天保留，60s 定时 + 关停时持久化，模块级单例注册表供只读路由取用；UUID id 的 plan 以 `n:名称` 为 planKey）。新端点 `GET /api/dashboard/balance-history?hours=N`（默认 168h，钳制到保留窗口；store 未初始化时 503）。仪表盘新增「余额历史 · 1h K线」全宽面板（零依赖手写 SVG）：绿涨红跌蜡烛 + 收盘价淡蓝折线、绝对小时槽位（网关停机时段留空不做假数据）、悬停显示该小时开高低收/变动/采样数、24h/3天/7天/30天 范围切换（独立轻量刷新）、面板在无余额历史时整体隐藏；5s 轮询用 JSON 指纹比对避免重复重建 SVG。余额面板卡片与 K线数据均为只读聚合，随 `/api/dashboard/*` 默认豁免鉴权。
- fix/streaming-silent-failures: Streaming requests that died mid-stream (after the upstream sent ≥1 block and the gateway hijacked the response) were handled **silently**: the catch with `reply.raw.headersSent === true` logged no error at all, left the early `{durationMs: 0, statusCode: 0}` provider placeholder in place (dashboard showed "200 OK / 0 tokens"), and unconditionally called `router.markPlanFailed` — so a **client disconnect counted against the plan's circuit breaker** (5 of them spuriously opens it, threshold `failureThreshold: 5`). Root-caused by the 2026-08-13 ZCode stuck-streams incident (`docs/handoff-zcode-stuck-streams-2026-08-13.html`). Fixes, in both `src/routes/{anthropic,openai}/handlers.ts` streaming catches (primary + failover plan): (1) the catch now emits a `Streaming request failed mid-stream` **warn** with `{error, headersSent, clientClosed, durationMs, planId, planName, model}`; (2) `request-proxy.ts` tags errors triggered by client disconnect with `cause: 'client-abort'` (`onClientClose` destroys the upstream request; both `req.on('error')` and `res.on('error')` pass the tag), and the handler skips `markPlanFailed` for that cause while still refunding quota; (3) `attachProviderMetrics` in the headersSent path now records the real failure — `statusCode` 499 (client abort) / upstream statusCode / 502 (other), an `error` field added to `ProviderMetrics` (surfaced in `Request completed` logs), and `reply.raw.statusCode` is set so completion logs and the dashboard show the failure instead of 200/0. New tests: real-socket reproductions in `tests/unit/services/request-proxy.test.ts` (mid-stream upstream death → SSE `event: error` delivered; silent stall → idle timeout; client disconnect → `cause: 'client-abort'`) plus handler-level assertions in both route integration suites (warn logged, circuit breaker skipped for client aborts, provider status 499/502). Note: `npm run test:coverage` 80% threshold is currently below red on master too (~74.7%); this branch slightly raises it.
- feat/web-dashboard: **GitHub 风格日历热力图 + 布局重构**。原「历史每日 Token 统计」柱状图改为 contributions 式日历热力图（整页宽模块，26 周 × 7 天，13px 方格，周一为行首）：颜色按 sqrt(tokens/峰值) 分 5 档绿色（偶发尖峰不再压扁日常差异），悬停格子在底部检查条显示精确数字（`2026-05-13 · 90,022 tokens · 10 次请求`，原生 title 作兜底），今天高亮描边，未来格子留空，月份/星期标签中文，图例 + 累计/峰值摘要。布局重排为优先级序：统计卡 → [进行中请求 | Plan 余量] → 热力图 → [按 Key | 按 Plan] → 按模型（无数据时整面板隐藏）→ 近期请求 → 近期错误。**进行中请求面板压缩**：>10 分钟的疑似异常长请求自动折叠进一条警示行（点击展开含入口 URL 的完整表格），不再长期霸占屏幕；正常请求最多列 12 行、按时长排序。
- feat/web-dashboard: **Pagination + filters** for the「近期完成的请求」and「近期错误」panels — client-side pages of 20 with a pager; request filters: status (all/ok/fail), API key, plan, model search; error filters: level + keyword. Interactive panels hold local state and re-render only on user events after first paint, so the 5s poll never clobbers an open filter or a search box mid-typing (focus+caret restored after each keystroke re-render). The recent-requests time column is left-aligned. Server-side error buffer grew 20 → 100 (`MAX_ERRORS`) so paging has history. deploy.sh: the update-check now only trusts FETCH_HEAD from a fetch that succeeded in this run, and prefers origin/master when it covers HEAD (typical right after pushing from the deploy host itself).
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

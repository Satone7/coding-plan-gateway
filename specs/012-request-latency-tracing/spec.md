# Feature Specification: Request Latency Tracing

**Feature Branch**: `012-request-latency-tracing`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "设计一个机制，记录一个请求在每个阶段的耗时，并在log中打印。注意多请求并发时要区分开每个请求，单独计时，并在log中显著区分（最好不同请求的log可以输出不同颜色）"

## User Scenarios & Testing

### User Story 1 - 查看请求各阶段耗时 (Priority: P1)

作为开发者，我希望在日志中看到每个请求在各阶段（如路由选择、配额检查、API Key解密、上游请求等）的耗时，以便识别性能瓶颈。

**Why this priority**: 这是用户请求此功能的根本原因——他们已经发现 Gateway 访问速度慢于直接访问平台，需要工具来定位具体哪个阶段耗时。

**Independent Test**: 发送一个 HTTP 请求到 Gateway，检查日志输出中是否包含该请求在各阶段的耗时数据。

**Acceptance Scenarios**:

1. **Given** Gateway 运行中且配置了至少一个 plan，**When** 发送一个有效的 chat/completions 请求，**Then** 日志中包含 `validation`、`routing`、`quotaCheck`、`apiKeyDecryption`、`upstreamRequest`、`total` 等阶段的耗时

2. **Given** 请求被路由到选中的 plan，**When** 请求完成（成功或失败），**Then** 日志中按执行顺序列出每个阶段的名称和耗时（毫秒）

3. **Given** 多个 plan 可用，**When** 请求触发 failover 到备用 plan，**Then** 日志中记录 failover 尝试的阶段和耗时

---

### User Story 2 - 区分并发请求 (Priority: P2)

作为开发者，我希望能够从日志中清晰区分同时到达的多个请求，避免日志混杂难以阅读。

**Why this priority**: 在调试高并发场景或 Claude Code 持续发送请求时，日志混杂会导致无法追踪单个请求的完整流程。

**Independent Test**: 同时从两个终端发送请求到 Gateway，检查两个请求的日志是否可通过 requestId 清晰区分。

**Acceptance Scenarios**:

1. **Given** 两个并发请求同时到达 Gateway，**When** 两个请求都在处理中，**Then** 每个请求的日志都携带相同的 requestId，且两个请求的日志 requestId 不同

2. **Given** 某请求日志中出现错误，**When** 开发者需要追踪该请求的完整流程，**Then** 可通过 requestId 在日志中筛选出该请求的所有日志行

---

### User Story 3 - 可视化区分请求 (Priority: P3)

作为开发者，我希望不同请求的日志在终端中能够通过颜色或唯一前缀进行视觉区分，以便在大量日志中快速定位目标请求。

**Why this priority**: 即使有 requestId，如果日志量很大，在终端中查找特定请求的日志仍然困难。颜色或唯一前缀可以提供即时的视觉区分。

**Independent Test**: 同时发送多个请求，检查终端输出中不同请求是否使用不同颜色或前缀。

**Acceptance Scenarios**:

1. **Given** 三个并发请求到达 Gateway，**When** 查看实时日志输出，**Then** 每个请求的日志行使用不同的 ANSI 颜色标记

2. **Given** 请求处理包含多个阶段，**When** 查看日志输出，**Then** 同一请求的所有日志行使用相同的颜色/前缀，形成视觉连贯性

---

### Edge Cases

- What happens when upstream provider is slow or times out? 日志应记录 upstream 阶段的实际耗时（包括 timeout 发生时的耗时）
- How does system handle requests that fail before reaching upstream? 验证失败、路由失败等场景的日志应清楚记录失败阶段的耗时
- What happens when quota is exhausted mid-request? quotaCheck 阶段的耗时仍应被记录，即使后续跳过 upstream 阶段
- How does the system handle streaming requests? streaming 请求的耗时记录应在请求开始时记录各阶段，stream 完成时记录总耗时

## Requirements

### Functional Requirements

- **FR-001**: System MUST track elapsed time for each of the following stages: `requestReceived`, `validation`, `routing`, `quotaCheck`, `apiKeyDecryption`, `upstreamRequest`, `responseSent`
- **FR-002**: System MUST record elapsed time in milliseconds with at least millisecond precision for each stage
- **FR-003**: System MUST associate all log entries for a single request with the request's unique identifier (requestId from Fastify's requestIdHeader)
- **FR-004**: System MUST output stage timing summary as a structured JSON log line when a request completes (success or failure), containing: requestId, colorIndex, totalDurationMs, and an array of phases each with name and durationMs
- **FR-005**: System MUST use ANSI color codes to visually differentiate concurrent requests — each request is assigned a distinct color from a fixed palette, and all log lines for that request are prefixed with the color code (e.g., `\x1b[31m` for red) so terminals can render them in that color
- **FR-006**: System MUST assign colors based on request sequence number (modulo number of available colors in the palette) to ensure color reuse is rare in normal operation
- **FR-007**: The latency tracking mechanism MUST NOT add more than 1ms overhead to request processing under normal conditions
- **FR-008**: System MUST include total request duration (from request received to response sent) in the timing summary
- **FR-009**: System MUST log timing data even when requests fail, capturing how far the request progressed before failure
- **FR-010**: Timing data MUST be logged at `info` level or higher (not `debug`) to ensure visibility in default log configuration
- **FR-011**: Timing tracing MUST only apply to external API requests — specifically `/v1/chat/completions`, `/v1/messages`, and admin API endpoints (`/api/*`). Internal endpoints (`/health`, `/ready`, `/internal/*`) are excluded from timing tracing

### Key Entities

- **RequestTrace**: Represents the timing data for a single request through all stages. JSON representation: `{requestId: string, colorIndex: number (0-9), totalDurationMs: number, phases: [{name: string, durationMs: number}]}`
- **StageTiming**: Represents timing for a single processing stage. Key attributes: stageName, startTimestamp, endTimestamp, durationMs
- **TimingSummary**: The JSON log line containing all stage timings and total duration for a request

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of completed requests have timing data logged in the standard format with all documented stages present
- **SC-002**: A developer can identify which specific stage is slowest for a given request by reading the timing summary JSON — phases are ordered by execution sequence and include durationMs field
- **SC-003**: When two requests are processed concurrently, a developer can distinguish which log lines belong to which request using the requestId or color/prefix within 5 seconds of inspection
- **SC-004**: The latency tracking overhead is not perceptible to end users — requests complete in essentially the same wall-clock time whether timing is enabled or not (verified by benchmark comparison)
- **SC-005**: Failed requests (upstream timeout, validation error, etc.) have timing data showing exactly how far the request progressed before failure
- **SC-006**: Log output format is consistent across all request types (OpenAI chat completions, Anthropic messages, streaming, non-streaming)

---

## Clarifications

### Session 2026-03-27

- Q: Visual differentiation via color vs prefix — which to use? → A: ANSI color codes (Option A) — each request assigned a distinct ANSI color from a fixed palette; all log lines for that request prefixed with color code for terminal rendering
- Q: Color palette size (8 vs 10 vs 12)? → A: 10 distinct ANSI colors (Option B) — balanced between concurrent distinction and palette manageability
- Q: Timing summary log format (free-text vs JSON vs multi-line)? → A: JSON line format (Option B) — structured JSON log line with requestId, colorIndex, totalDurationMs, and phases array; machine-parseable yet human-readable
- Q: Scope of timing tracing — all HTTP requests or only external API? → A: External API only (Option B) — tracing applies to `/v1/chat/completions`, `/v1/messages`, and `/api/*`; internal endpoints (`/health`, `/ready`, `/internal/*`) excluded
- Q: Color collision concern for high concurrency (>10)? → A: Assume normal operation ≤10 concurrent requests (Option A) — 10-color palette sufficient; color collisions acceptable since requestId always available for disambiguation

## Assumptions

- The gateway already generates a unique requestId for each request (Fastify's `requestIdHeader`)
- The existing logger supports ANSI color codes in terminal output
- The performance overhead of timing must be minimal — implementations should avoid synchronous date calls in hot paths
- Colors will be assigned from a fixed palette of exactly 10 distinct ANSI colors to ensure contrast and readability
- Color is assigned based on request sequence number (modulo palette size) rather than free-form allocation

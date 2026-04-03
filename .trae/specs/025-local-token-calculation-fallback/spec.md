# Local Token Calculation Fallback Spec

## Why
目前项目中的 token 统计完全依赖上游 API 的返回结果（`usage` 对象）。如果上游 API（特别是某些代理或开源模型提供商）不返回具体的 token 消耗数据，或者在流式返回的尾部丢失 token 统计数据，将会导致系统的 token 统计记录不准确（漏算、记为 0）。
为了保证系统 token 统计的准确性和健壮性，系统需要在上游 API 缺失 token 消耗数据时，使用本地计算（Fallback）作为补充机制，确保请求记录中始终包含估算的 Token 数据。这与 `/count_tokens` 路由的 Fallback 机制保持一致。

## What Changes
- 提取 `/count_tokens` 的本地估算逻辑为公共 `TokenCounter` 工具函数。
- 为 Anthropic 和 OpenAI 请求分别实现 Request Input Token（`prompt` / `messages`）和 Response Output Token 的本地估算函数。
- 在 `RequestProxy` 的流式请求处理中（`makeStreamingRequest`），通过解析 SSE 数据流，提取并累加生成的文本。
- 在流式（Stream）请求回调中，若 `tokenUsage` 缺失，则触发 Fallback 逻辑，使用本地算法估算请求输入与生成的文本。
- 在非流式请求的回调处理中（`recordMetrics`），若 `usage` 数据缺失或为 0，触发 Fallback 逻辑。
- 确保所有的 Token Fallback 结果都能正确附加到 Request Metrics 中，最终被 `request-logger.ts` 记录到数据库/日志。

## Impact
- Affected specs: 增强了 Token 记录的鲁棒性。
- Affected code:
  - `src/utils/token-counter.ts` (新建)
  - `src/routes/anthropic/handlers.ts` (修改)
  - `src/routes/openai/handlers.ts` (修改)
  - `src/services/request-proxy.ts` (修改)

## ADDED Requirements
### Requirement: Local Token Calculation Fallback
系统 SHALL 在上游 API 不返回 `usage` 字段（无论是普通请求还是流式请求）时，自动触发本地的 Token 估算。

#### Scenario: Success case (Streaming)
- **WHEN** 用户发起流式对话请求，上游 API 在流的最后没有包含 `usage` 字段。
- **THEN** 系统在流结束时，通过分析原始请求体（输入）和在流传输期间积累的文本数据（输出），使用本地算法估算总 token 数，并写入请求指标（Metrics）。

#### Scenario: Success case (Non-Streaming)
- **WHEN** 用户发起普通对话请求，上游 API 返回的响应中缺少 `usage` 对象。
- **THEN** 系统通过分析请求体（输入）和响应体中的生成文本（输出），估算出 total tokens 并记录。

## MODIFIED Requirements
### Requirement: Token Counter Utilities
原有的 `/count_tokens` fallback 逻辑需被重构并扩展，不仅支持 Anthropic 的请求格式估算，也支持 OpenAI 格式的请求及响应体估算。
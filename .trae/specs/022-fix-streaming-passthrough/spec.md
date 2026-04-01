# Fix Streaming Passthrough Spec

## Why
用户反馈在使用网关代理 Claude Code 请求时，响应速度明显慢于直连，并且流式传输失效（Claude Code 无法持续统计 token）。经过分析，发现网关存在以下两个核心问题：
1. **性能问题与延迟过高**：网关在处理流式响应时（`handleStreamingResponse`），错误地将二进制数据流转换为了全量字符串，并进行了频繁的字符串拼接、正则分割和按行遍历。这种做法在大文本流式传输时会导致严重的内存碎片和 CPU GC 损耗，极大增加了流式输出的首字延迟和后续处理延迟。
2. **流式透传数据损坏失效**：网关的解析逻辑被硬编码为仅处理 OpenAI 格式的 SSE 数据（强制过滤仅保留 `data: ` 开头的行）。这导致 Anthropic 格式中关键的 `event: ` 头部（例如 `event: message_delta` 等用于触发 token usage 统计和增量文本渲染的事件）被网关完全丢弃和覆写。因此，Claude Code 的 SDK 客户端无法正确解析流事件，导致 token 统计失效和流式输出异常。

## What Changes
- **重构流式请求处理逻辑**：在 `src/services/request-proxy.ts` 中，废弃通过手动拼接长字符串并按行解析 SSE 数据的错误做法。
- **引入原生流式透传 (Stream Pipe)**：对于流式请求，直接将上游返回的二进制响应流通过 Node.js 原生的 `.pipe()` 方法无缝导向客户端（`reply.raw`），实现真正的零拷贝二进制透传。
- **兼容 OpenAI 和 Anthropic 数据格式**：不再试图在网关层“拦截、解析并重组”流数据包（保留 `event: ` 和 `data: ` 等所有原始报文特征），确保客户端能接收到百分之百完整的流式事件，从而让 Claude Code 的流处理和 Token 统计功能恢复正常。

## Impact
- Affected specs: 001-coding-plan-gateway
- Affected code:
  - `src/services/request-proxy.ts` (请求代理与数据处理逻辑)

## MODIFIED Requirements
### Requirement: Streaming Response Handling
系统在处理流式代理请求时，SHALL 采用底层数据流管道 (Pipe) 进行零拷贝透传，而不应当在内存中完整拼接并二次序列化/反序列化。透传过程必须保持原始响应中的 SSE 格式（包括 Anthropic 的 `event:` 标识和 OpenAI 的所有原始标识）原封不动地返回给客户端。

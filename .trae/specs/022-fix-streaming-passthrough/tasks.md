# Tasks
- [x] Task 1: 重构 `RequestProxy` 的内部流式处理机制
  - [x] SubTask 1.1: 移除 `src/services/request-proxy.ts` 中的 `handleStreamingResponse` 字符串缓冲与正则过滤逻辑。
  - [x] SubTask 1.2: 更新 `InternalStreamingOptions` 接口，以便直接接收可写流（Writable Stream，如 FastifyReply.raw）。
  - [x] SubTask 1.3: 在 `makeStreamingRequest` 中通过 `res.pipe()` 进行数据直接透传。
- [x] Task 2: 修复 OpenAI 与 Anthropic 代理的外部调用
  - [x] SubTask 2.1: 在 `forwardOpenAIStream` 中不再使用 `onChunk` 处理单个 chunk，改用回调函数监听整个管道的结束（`end`）和错误（`error`）事件以记录耗时。
  - [x] SubTask 2.2: 在 `forwardAnthropicStream` 中进行相同的处理，直接透传 `reply.raw`，完全保留 `event:` 标识，仅在 `end` 触发时回调路由层以计入成功状态并打日志。

# Task Dependencies
- [Task 2] depends on [Task 1]

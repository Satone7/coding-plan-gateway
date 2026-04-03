# Tasks

- [x] Task 1: 创建共享 Token 计数工具类 `TokenCounter`
  - [x] SubTask 1.1: 提取 `src/routes/anthropic/handlers.ts` 中的 `estimateTokenCount`，移至新建的 `src/utils/token-counter.ts`。
  - [x] SubTask 1.2: 扩展 `TokenCounter` 支持计算 Anthropic 和 OpenAI 格式的输入请求 Token。
  - [x] SubTask 1.3: 扩展 `TokenCounter` 支持直接传入生成的纯文本计算 Output Token。

- [x] Task 2: 改造 `RequestProxy` 提取流式请求生成的文本
  - [x] SubTask 2.1: 在 `src/services/request-proxy.ts` 的 `makeStreamingRequest` 中，增加 SSE 流解析逻辑，累加流式输出文本（处理 Anthropic 的 `delta.text` 和 OpenAI 的 `delta.content`）。
  - [x] SubTask 2.2: 将累加的文本作为 `onComplete` 回调的第二个参数传递，供 Handler 使用。

- [x] Task 3: 在 Anthropic Handler 中实现 Fallback
  - [x] SubTask 3.1: 在 `src/routes/anthropic/handlers.ts` 的流式请求处理回调中，如果缺失 `tokenUsage`，则调用 `TokenCounter` 传入请求体和累加文本计算 Token。
  - [x] SubTask 3.2: 在非流式请求的 `recordMetrics` 中，若解析不到 `tokenUsage`，则从 `response.data` 中提取生成文本并结合请求体进行本地 Token 计算并记录。

- [x] Task 4: 在 OpenAI Handler 中实现 Fallback
  - [x] SubTask 4.1: 在 `src/routes/openai/handlers.ts` 的流式请求回调中，若缺失 `tokenUsage`，则调用 `TokenCounter` 传入请求体和累加文本计算 Token。
  - [x] SubTask 4.2: 在非流式请求的 `recordMetrics` 中，若解析不到 `tokenUsage`，则从 `response.data` 提取生成文本并进行本地 Token 计算。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 2]
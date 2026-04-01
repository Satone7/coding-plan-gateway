# TUI Dashboard Spec

## Why
当前项目缺少实时监控的核心功能。为了更直观地观察网关的运行状态（如正在处理的请求、请求来源的 API Key、路由选择的 Plan、当前所处阶段及处理耗时等），需要一个独立的可视化仪表盘。考虑到未来可能会有 Web 版仪表盘，TUI 的状态管理和数据解析逻辑需要与视图层解耦，以实现核心逻辑代码在 Web 端复用。

## What Changes
- **消息队列 (IPC)**: 在主项目中，增加通过 IPC (Unix Domain Socket) 广播 `debug` 及以上级别日志的功能，形成一个轻量级的消息队列。
- **独立子模块**: 新建 `src/dashboard/` 作为独立子模块，包含 TUI 仪表盘代码。
- **状态管理抽象**: 编写独立且可复用的 React Hooks（如 `useDashboardState`），负责连接 IPC、解析日志流，维护当前请求列表、阶段耗时、Plan 状态等数据，为未来的 Web 仪表盘铺垫。
- **Ink UI**: 使用 `ink` 构建美观的终端界面，展示请求状态、耗时、请求来源 API Key 的 name、Plan 的 RPM 限制等信息。

## Impact
- Affected specs: 无
- Affected code:
  - `src/utils/logger.ts` (增加日志发布到 IPC 的支持)
  - `src/utils/ipc-server.ts` (新建，用于启动 IPC Socket Server)
  - `src/index.ts` (启动/关闭 IPC Server)
  - `package.json` (增加 `ink` 依赖和启动脚本 `npm run dashboard`)
  - `src/dashboard/*` (新建仪表盘相关文件)

## ADDED Requirements
### Requirement: 实时日志广播
系统 SHALL 在启动时创建一个 IPC 服务（Unix Socket），并将所有级别为 `debug` 及以上的日志（包括上下文信息如 `requestId`, `planId`, `model`, `apiKeyName`, `stage`, `duration` 等）通过 JSON 格式广播给所有连接的客户端。

### Requirement: TUI 仪表盘展示
系统 SHALL 提供一个通过 `ink` 构建的独立终端命令（如 `npm run dashboard`），连接到 IPC 服务，并美观地展示：
- 当前正在处理的请求列表。
- 请求的详细信息：请求来源的 API Key name、选择的 Plan ID/名称、当前所处阶段及耗时。
- Plan 的使用情况：当前 RPM 等状态。

### Requirement: 逻辑与视图解耦
仪表盘的数据处理和状态更新 SHALL 封装为独立的可复用模块（如 React Hooks 或独立的 Store 类），使得纯展示层的 UI 代码与业务数据逻辑分离，以便后续直接在 Web 端 React 项目中复用该模块。

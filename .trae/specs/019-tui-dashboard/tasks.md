# Tasks
- [x] Task 1: 引入依赖并配置子模块
  - [x] SubTask 1.1: 在 `package.json` 中添加 `ink`, `react` 等相关依赖，并增加 `dashboard` 的启动脚本。
- [x] Task 2: 实现 IPC 日志广播服务
  - [x] SubTask 2.1: 在 `src/utils/` 下新建 `ipc-server.ts`，使用 Node.js `net` 模块创建 Unix Socket IPC 服务（支持发布订阅模式）。
  - [x] SubTask 2.2: 修改 `src/utils/logger.ts`，使其能够将 `debug` 及以上的日志以及其 context 数据格式化为 JSON 并异步发送到 IPC 服务。
  - [x] SubTask 2.3: 在 `src/index.ts` 的生命周期中启动和关闭 IPC 服务。
  - [x] SubTask 2.4: 确保主项目中关键的业务逻辑处（请求开始、请求结束、Plan 选取、耗时统计等阶段）通过 `logger.debug` 打印出了足够的 context（如 `requestId`, `apiKeyName`, `planId`, `stage`, `duration` 等），供 Dashboard 解析。
- [x] Task 3: 实现仪表盘状态管理 (可复用)
  - [x] SubTask 3.1: 在 `src/dashboard/hooks/` 编写 `useDashboardState.ts`，通过 Node.js `net` 模块连接 IPC Socket，接收并解析流式 JSON 日志。
  - [x] SubTask 3.2: 根据日志的 context 计算和聚合：当前正在处理的活动请求、各请求当前所处阶段及耗时、被选择的 Plan 及 RPM 使用情况、请求来源 API Key 的 name。
- [x] Task 4: 使用 Ink 构建 TUI 视图
  - [x] SubTask 4.1: 在 `src/dashboard/components/` 构建 UI 组件（如：顶部状态栏、请求列表表格、Plan 监控面板等），界面需美观直观。
  - [x] SubTask 4.2: 在 `src/dashboard/index.tsx` 中组装 Ink 应用，接入 `useDashboardState` 并渲染到终端。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 2]
- [Task 4] depends on [Task 3]

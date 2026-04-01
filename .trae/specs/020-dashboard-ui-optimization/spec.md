# Dashboard UI Optimization Spec

## Why
目前仪表盘功能已基本可用，但在美观性上较为欠缺，且未能最大化利用终端空间。为了提升监控体验，我们需要优化界面布局，使其占满终端并动态适应调整。同时，监控核心关注点在于正在进行的活跃请求细节、关键报错（警告与错误）以及更精准多维度的统计数据。

## What Changes
- 仪表盘布局重构：全屏显示，占满终端宽度和高度，并支持动态调整。
- 活跃请求跟踪：重构“Request Status”模块，不再显示简单的统计数据，而是追踪每一个活跃请求。列出请求的 API Key、URL、被选中的 Plan 及得分、当前的持续时间（以秒为单位，实时更新）。
- 报错信息展示：新增专门的报错面板，展示最近的 5 个 warning 和 error，并分别使用黄色和红色区分。
- **BREAKING** 统计板块调整：移除原有的“Average Latency”板块。
- 新增多维度统计：统计已完成的请求总数；按 Plan 统计请求数和 Token 数；按模型（Model）统计请求数和 Token 数；按被使用的 API Key 统计请求数和 Token 数（忽略未被使用的 API Key）。

## Impact
- Affected specs: 仪表盘监控展示逻辑 (TUI)
- Affected code: `src/dashboard/` 下的 Ink UI 组件、状态管理 Hook（如 `useDashboardState.ts`）以及可能的 IPC 日志解析逻辑。

## ADDED Requirements
### Requirement: Dynamic Full-Screen Layout
The system SHALL render the dashboard taking up the full width and height of the terminal and re-render dynamically upon terminal resize.

### Requirement: Active Request Tracking
The system SHALL display a list of active requests, including their API Key, URL, selected Plan (with score), and a real-time updating duration counter in seconds. It SHALL use appropriate colors for distinct columns/status.

### Requirement: Recent Errors and Warnings
The system SHALL maintain and display a list of the 5 most recent warning or error logs, colored yellow and red respectively.

### Requirement: Multi-dimensional Usage Statistics
The system SHALL calculate and display completed request counts, and aggregate request and token counts grouped by Plan, Model, and used API Key.

## MODIFIED Requirements
### Requirement: Dashboard Statistics Panel
The system SHALL NOT display the "Average Latency" metric, and instead focus on the new multi-dimensional counts.

## REMOVED Requirements
### Requirement: Average Latency Display
**Reason**: Not required by the updated monitoring focus.
**Migration**: Remove from the dashboard UI and state calculation.
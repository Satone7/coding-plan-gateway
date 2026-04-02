# Dashboard Metrics Enhancement Spec

## Why
当前仪表盘的 USAGE BY PLAN 和 USAGE BY MODEL 中的进度条未能直观反映各分类在总用量中的占比，且 USAGE BY PLAN 缺少 RPM（每分钟请求数）的监控。此外，对于 ACTIVE REQUESTS，长时间挂起的请求需要有明确的超时判定机制，以更准确地反映系统健康状况。

## What Changes
- 修改 USAGE BY PLAN 和 USAGE BY MODEL 面板的进度条逻辑：当前分类的值将除以所有分类的总值来计算百分比。
- 在 USAGE BY PLAN 面板中新增 RPM 字段显示，其进度条将基于 RPM=100 的基准进行计算（RPM=100时进度条为100%）。
- 增强 ACTIVE REQUESTS 的监控逻辑：当请求的持续时间超过该请求所对应 PLAN 中配置的 `timeout` 时间时，自动将该请求判定为失败（并从活跃请求中移除或标记为失败状态）。

## Impact
- Affected specs: 仪表盘监控展示逻辑 (TUI)
- Affected code: `src/dashboard/` 下的 UI 组件（可能涉及 `UsageByPlan.tsx`, `UsageByModel.tsx`, `ActiveRequests.tsx` 等）及状态管理（如 `useDashboardState.ts`，日志解析等）。

## ADDED Requirements
### Requirement: RPM Monitoring
The system SHALL calculate and display the RPM (Requests Per Minute) for each Plan. The progress bar for RPM SHALL be 100% when RPM reaches 100.

### Requirement: Active Request Timeout Detection
The system SHALL continuously monitor active requests and automatically mark a request as failed if its duration exceeds the `timeout` value specified in its corresponding Plan.

## MODIFIED Requirements
### Requirement: Usage Progress Bars
The progress bars for USAGE BY PLAN and USAGE BY MODEL SHALL display the percentage of the current item's usage relative to the total usage across all items in that category, instead of an absolute or static baseline.
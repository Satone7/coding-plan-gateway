# Tasks
- [x] Task 1: 优化 USAGE BY PLAN 和 USAGE BY MODEL 的进度条显示
  - [x] SubTask 1.1: 计算 State 中所有 plan 和 model 的总用量
  - [x] SubTask 1.2: 更新面板渲染逻辑，将当前用量除以总用量，从而反映在进度条上
- [x] Task 2: USAGE BY PLAN 增加 RPM 字段及对应进度条
  - [x] SubTask 2.1: 在 State 中实现各个 plan 的 RPM（每分钟请求数）计算逻辑
  - [x] SubTask 2.2: 更新 USAGE BY PLAN UI，增加 RPM 字段的显示
  - [x] SubTask 2.3: 设置 RPM=100 的基准，计算对应进度条（当 RPM=100 时进度条为 100%）
- [x] Task 3: 优化 ACTIVE REQUESTS 中超时请求的处理
  - [x] SubTask 3.1: 识别每个活跃请求对应 plan 中配置的 `timeout` 值
  - [x] SubTask 3.2: 在更新状态或计算时长时，比较持续时间和 `timeout` 值
  - [x] SubTask 3.3: 超过 `timeout` 自动判定请求为失败状态（更新状态管理并从 ACTIVE REQUESTS 正常列表移除/标记）

# Task Dependencies
- [Task 2] depends on the state management capable of calculating rolling metrics (RPM).
- [Task 3] depends on having access to the plan configurations within the active request state.
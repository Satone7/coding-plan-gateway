# Tasks
- [x] Task 1: 仪表盘布局全屏化与动态调整：修改 Ink 根组件与布局容器，监听终端 `resize` 事件，实现宽度和高度占满全屏并自适应调整。
- [x] Task 2: 重构活跃请求跟踪模块（Request Status）：
  - [x] SubTask 2.1: 更新状态管理逻辑，精细化记录每个活跃请求的 API Key, URL, 选中的 Plan 及得分，以及请求开始时间。
  - [x] SubTask 2.2: 在 UI 层实现活跃请求列表，以秒为单位持续计时并更新显示持续时间，为不同字段配置适当的颜色加以区分。
- [x] Task 3: 实现最近报错面板：
  - [x] SubTask 3.1: 在状态管理中维护一个长度为 5 的队列，用于存储最近的 warning 和 error 日志。
  - [x] SubTask 3.2: 在 UI 层渲染该队列，warning 使用黄色，error 使用红色进行颜色区分。
- [x] Task 4: 重构统计面板：
  - [x] SubTask 4.1: 移除“Average Latency”相关的 UI 与状态计算逻辑。
  - [x] SubTask 4.2: 更新状态管理逻辑，分别按 Plan、Model、被使用的 API Key 统计已完成的请求数和 Token 数（忽略未被使用的 API Key）。
  - [x] SubTask 4.3: 在 UI 层新增面板展示已完成的请求总数及上述多维度统计数据。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 1]
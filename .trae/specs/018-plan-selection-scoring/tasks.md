# Tasks
- [x] Task 1: 优化 Plan 选择打分日志输出: 在计划选择策略中输出所有候选计划的多因素打分详情。
  - [x] SubTask 1.1: 修改 `src/services/plan-selector.ts` 中的 `quotaPriorityStrategy` 方法。
  - [x] SubTask 1.2: 在选择出最高分之前，遍历 `scores` 数组，结合对应的 Plan 信息构造并输出完整的日志（包括 planId, planName, totalScore, expiration score, rpm score, quota score）。
  - [x] SubTask 1.3: 运行相关单元测试，确保添加的日志不会影响路由策略的正常返回逻辑，并修复由于日志调用增加可能导致的相关测试失败（如 mock 的断言次数不一致等）。

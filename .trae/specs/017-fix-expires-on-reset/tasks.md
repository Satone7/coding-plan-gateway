# Tasks
- [x] Task 1: 检索并分析现有涉及 `expiresOn` 和计划 (plan) 消耗逻辑的代码。
  - [x] SubTask 1.1: 在全局搜索 `expiresOn`、`plan`、`usage`、`reset` 等关键字。
  - [x] SubTask 1.2: 确定当前系统中检查过期和扣减额度的核心模块位置。
- [x] Task 2: 修复过期未重置消耗的 Bug。
  - [x] SubTask 2.1: 在判定已过期的逻辑分支中，加入重置消耗（例如将其置为 0）的代码。
  - [x] SubTask 2.2: 确保重置操作能够正确持久化到数据库或缓存中。
  - [x] SubTask 2.3: （如适用）更新下一个周期的 `expiresOn`。
- [x] Task 3: 验证修复结果。
  - [x] SubTask 3.1: 编写或修改单元测试/集成测试，覆盖 plan 过期的场景。
  - [x] SubTask 3.2: 运行测试并确保所有测试用例通过。

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2

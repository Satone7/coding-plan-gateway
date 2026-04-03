# Tasks
- [x] Task 1: 更新配置文件 Schema 和类型定义
  - [x] SubTask 1.1: 在 `src/types/coding-plan.ts` 的 `CodingPlan`、`CreateCodingPlanInput` 和 `UpdateCodingPlanInput` 中添加 `modelAliases?: Record<string, string>` 属性。
  - [x] SubTask 1.2: 在 `src/config/schema.ts` 中，将 `modelAliasesSchema` 移出根级的 `configSchema`，并添加到 `planConfigSchema`。
- [x] Task 2: 移除或废弃全局 ModelResolver 服务
  - [x] SubTask 2.1: 删除或重构 `src/services/model-resolver.ts`（因为我们不再需要全局的别名解析服务）。
  - [x] SubTask 2.2: 从 `src/services/request-router.ts` 的构造函数和内部属性中移除 `ModelResolver` 的依赖。
  - [x] SubTask 2.3: 更新 `src/config/index.ts`，移除与热重载全局 `modelAliases` 相关的方法 `reloadModelAliases`。
- [x] Task 3: 重构 PlanSelector 和 PlanRepository
  - [x] SubTask 3.1: 修改 `src/services/plan-repository.ts` 的 `configToPlan` 和 `planToConfig`，确保 `modelAliases` 被正确序列化和反序列化。
  - [x] SubTask 3.2: 修改 `src/services/plan-repository.ts` 的 `findByModel` 方法，使其不仅检查 `plan.models`，还要检查 `plan.modelAliases` 且其目标模型存在于 `plan.models` 中。
  - [x] SubTask 3.3: 修改 `src/services/plan-selector.ts` 的 `findPlansByModel` 和 `supportsModel` 方法，加入相同的别名检查逻辑（支持大小写不敏感匹配）。
- [x] Task 4: 更新 RequestRouter 获取 Canonical Name 逻辑
  - [x] SubTask 4.1: 修改 `src/services/request-router.ts` 的 `route` 方法：移除 `modelResolver.resolveWithOriginal` 调用，直接使用原始模型名查找 plans。
  - [x] SubTask 4.2: 在 `route` 方法选定 `selectedPlan` 后，确定要向上游发送的 `canonicalName`。逻辑：如果在 `models` 中精确匹配，使用该原始大小写；如果命中 `modelAliases`，提取映射目标，并返回该目标在 `models` 中规定的确切大小写名称。
  - [x] SubTask 4.3: 修复 `getPlanForRequest` 方法，正确报告找不到模型时的可用模型列表。
- [x] Task 5: 重写 onboard 命令
  - [x] SubTask 5.1: 在 `src/cli/commands/onboard.ts` 的主菜单中移除 `Configure Model Aliases` 选项。
  - [x] SubTask 5.2: 在 `promptPlanDetails` 函数中加入一个交互步骤，询问并收集该 plan 的 `modelAliases`。例如输入格式可以是逗号分隔的 `alias:canonical`，并解析为对象保存到 plan 中。
- [x] Task 6: 更新相关单元测试
  - [x] SubTask 6.1: 修复 `tests/unit/services/request-router.test.ts` 中涉及路由和报错信息的测试用例。
  - [x] SubTask 6.2: 修复 `tests/unit/services/plan-selector.test.ts` 中的匹配逻辑用例。
  - [x] SubTask 6.3: 删除或更新有关 `model-resolver.test.ts` 的废弃测试。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 1]
- [Task 6] depends on [Task 1, Task 2, Task 3, Task 4, Task 5]

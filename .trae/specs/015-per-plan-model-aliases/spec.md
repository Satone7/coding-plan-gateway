# Per-Plan Model Aliases Spec

## Why
目前项目中 `model alias` 功能是全局配置的，这会导致当不同 plan 支持不同的模型版本或别名时产生冲突。为了提供更细粒度的控制，需要重写该功能，将 `model alias` 配置下放到每个 plan 中。这样，不同的 plan 可以根据自身支持的模型列表独立配置别名（例如在 Plan 3 中配置 `glm-5 -> glm-5-turbo`）。

## What Changes
- **BREAKING**: 将 `modelAliases` 从全局配置 `Config` 中移除。
- 将 `modelAliases` 添加到 `PlanConfig` 中，每个 plan 独立维护自己的别名映射。
- 重写匹配逻辑：当用户请求一个模型时，系统将同时检查 plan 的 `models` 列表和 `modelAliases` 映射。
- 增加验证逻辑：如果用户请求的模型命中了某个 plan 的 `modelAliases`，系统必须验证该别名指向的目标模型（`->` 后的模型）是否存在于该 plan 的 `models` 列表中。如果不存在，则该 plan 不能作为匹配项。
- 向上游请求约束：一旦匹配成功，无论是因为直接命中 `models` 还是通过 `modelAliases` 命中，最终向上游发起请求时，必须严格使用该 plan 的 `models` 列表中规定的模型名称（即别名的目标名称，并保持正确的大小写）。
- 更新 `onboard` 命令：移除主菜单中全局的 `Configure Model Aliases` 选项，将模型别名的配置功能集成到 `Manage Plans` 的流程中，允许用户在编辑或添加 plan 时修改其别名。

## Impact
- Affected specs: 请求路由、负载均衡、命令行配置工具。
- Affected code: 
  - `src/config/schema.ts`
  - `src/types/coding-plan.ts`
  - `src/services/plan-repository.ts`
  - `src/services/plan-selector.ts`
  - `src/services/request-router.ts`
  - `src/cli/commands/onboard.ts`
  - `src/services/model-resolver.ts` (将被废弃或移除)
  - 相关的单元测试文件

## ADDED Requirements
### Requirement: Plan 级别的模型别名配置
系统必须允许在每个 Coding Plan 中独立配置模型别名映射（例如：`"glm-5": "glm-5-turbo"`）。

#### Scenario: 成功匹配并使用正确的名称请求上游
- **WHEN** 用户请求模型 `glm-5`
- **AND** Plan 3 的 `models` 包含 `["glm-5-turbo"]` 且 `modelAliases` 配置为 `{"glm-5": "glm-5-turbo"}`
- **THEN** 系统选择 Plan 3，并使用名称 `glm-5-turbo` 向上游发起请求。

#### Scenario: 别名目标模型不存在于 models 中
- **WHEN** 用户请求模型 `glm-5`
- **AND** Plan 4 的 `models` 不包含 `["glm-5-turbo"]`，但 `modelAliases` 配置为 `{"glm-5": "glm-5-turbo"}`
- **THEN** Plan 4 不参与匹配，因为它未能通过别名目标模型有效性验证。

## MODIFIED Requirements
### Requirement: 路由与匹配逻辑重写
请求路由必须废弃全局的 ModelResolver，改为在遍历 plan 时，动态检查传入模型名称是否在 plan.models 或 plan.modelAliases 中，并在最终确定 Plan 后提取其 canonical name 用于上游请求。

## REMOVED Requirements
### Requirement: 全局模型别名配置
**Reason**: 全局别名无法满足多 Plan 差异化模型映射的需求。
**Migration**: 移除 `config.yaml` 根级别的 `modelAliases`，所有的别名将被强制迁移或重新配置到对应的 plan 中。

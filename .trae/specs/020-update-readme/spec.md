# Update README Spec

## Why
项目近期合入了一系列新特性（如模型别名配置、请求耗时追踪、大小写不敏感匹配、高级负载均衡策略等），但 `README.md` 尚未更新以反映这些最新功能。需要重新审查整个项目，更新 README 使其描述准确。

## What Changes
- 在 **Features** 列表中添加最近实现的新功能（高级负载均衡、请求阶段耗时追踪、模型大小写不敏感匹配、模型别名配置等）。
- 更新 **Configuration** 部分，补充 `config.yaml` 中新增的全局配置项，如 `loadBalancing` 和 `modelAliases`。
- 检查并修正 CLI 使用部分的说明（如确保运行前需要 build 的提示更加明显）。
- 整体优化 README 结构，使其能够更准确地反映当前项目的全貌。

## Impact
- Affected specs: 无 (仅文档更新)
- Affected code: `/workspace/README.md`

## ADDED Requirements
### Requirement: 更新特性列表
系统文档 SHALL 在 Features 部分包含所有核心功能，包括但不限于多因素负载均衡、模型别名、请求延迟追踪等。

### Requirement: 完善配置说明
系统文档 SHALL 在配置说明中补充 `loadBalancing` 和 `modelAliases` 示例，确保用户能够正确配置新功能。

## MODIFIED Requirements
### Requirement: 修正命令行执行说明
明确指出 `cpg` 命令行工具在使用前需要执行 `npm run build`，或者推荐使用 `npm run cpg` 脚本。

# Update README based on Recent PRs Spec

## Why
项目的 README 文件可能未能及时反映最近合并的多个 Pull Request (PR) 或 Commit 带来的功能更新、配置变更或修复。为了保证文档的准确性和时效性，需要检查近期的 PR，并将其中的关键变更同步到 README 中。

## What Changes
- 分析近期的 Git 提交历史或 PR 记录，找出 README 落后的变更。
- 逐个检查这些变更的内容（如新特性、配置项更改、命令更新等）。
- 将识别出的关键变更补充并更新到 `README.md` 文件中。

## Impact
- Affected specs: 无（仅影响文档）。
- Affected code: `/workspace/README.md`

## ADDED Requirements
### Requirement: 同步 PR 变更到 README
项目文档 SHALL 提供最新的、与代码库实际功能和配置相匹配的说明。

#### Scenario: Success case
- **WHEN** 开发者查看项目的 README
- **THEN** 能够看到最近引入的所有重要特性和配置说明。

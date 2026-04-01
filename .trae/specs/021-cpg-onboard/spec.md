# CPG Onboard Command Spec

## Why
用户直接修改 `config.yaml` 容易出错，且不够直观。为了提升用户体验并避免配置错误，需要提供一个 `cpg onboard` 交互式命令行向导（TUI），类似于 OpenClaw 的 onboard 命令。该功能可以在生产环境（如 Docker 容器）中直接运行，方便用户修改和完善所有支持的配置项。

## What Changes
- 在 `cpg` CLI 中增加 `onboard` 命令（`cpg onboard`）。
- 引入轻量级 TUI 交互库（例如 `@clack/prompts` 或 `enquirer`）来实现交互式向导，引导用户一步步完成配置。
- 支持全局配置的管理（包括 `loadBalancing`、`modelAliases` 等可配置项）。
- 支持 Plan 的添加、修改和删除。
- 添加 Plan 时，`id` 按照当前已有 Plan 的整数 ID 排序，自动生成下一个自增的整数 ID（即 `max(id) + 1`，如果不存在则从 `1` 开始）。
- 最终结果验证并保存至 `config.yaml` 文件，自动格式化并保留原有结构，避免用户手动编辑配置。
- 确保在 Docker 生产环境中，可通过 `docker exec -it <container> cpg onboard` 正常交互使用。

## Impact
- Affected specs: CPG CLI Command Structure (`006-cpg-cli`)
- Affected code: `src/cli/index.ts`, `src/cli/commands/onboard.ts`, `package.json` (新增 TUI 依赖)。

## ADDED Requirements
### Requirement: `cpg onboard` TUI
系统 SHALL 提供一个 `cpg onboard` 命令，进入交互式向导（TUI）界面。

#### Scenario: 自动生成 Plan ID
- **WHEN** 用户在 TUI 中选择“添加新的 Plan”
- **THEN** 系统自动扫描当前所有 Plan，找出最大的数字 ID，为新 Plan 分配 `max(id) + 1` 作为新 ID。

#### Scenario: 修改全部配置项
- **WHEN** 用户启动 `cpg onboard`
- **THEN** 系统展示主菜单，包含：1. 管理 Plans；2. 配置负载均衡 (Load Balancing)；3. 配置模型别名 (Model Aliases)；4. 保存并退出。用户可进入各子菜单调整所有支持的配置。

#### Scenario: Docker 环境可用性
- **WHEN** 在 Docker 生产容器中执行 `cpg onboard`
- **THEN** CLI 能够读取容器内的 `config.yaml`，展示 TUI 并成功覆盖保存更改，支持交互式操作。

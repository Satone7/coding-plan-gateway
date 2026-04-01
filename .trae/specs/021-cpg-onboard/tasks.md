# Tasks

- [x] Task 1: 引入 TUI 依赖并搭建 `onboard` 命令骨架
  - [x] SubTask 1.1: 在 `package.json` 中安装合适的交互式命令行库（推荐 `@clack/prompts`，或者 `enquirer`）。
  - [x] SubTask 1.2: 在 `src/cli/commands/onboard.ts` 中创建 `handleOnboardCommand` 基础处理函数。
  - [x] SubTask 1.3: 修改 `src/cli/index.ts` 注册并路由 `onboard` 命令。

- [x] Task 2: 实现配置的读取与主菜单交互逻辑
  - [x] SubTask 2.1: 实现读取当前 `config.yaml` 文件的逻辑，若文件不存在或为空，则初始化为默认空配置（通过 `loadConfig` 或 `createEmptyConfig`）。
  - [x] SubTask 2.2: 构建主菜单交互循环，选项包含：管理 Plans、配置负载均衡、配置模型别名、保存并退出。

- [x] Task 3: 实现 Plan 管理（增删改）交互逻辑
  - [x] SubTask 3.1: 实现 Plan 列表展示与选择逻辑，允许用户选择一个已有 Plan 进行修改或选择“新增 Plan”。
  - [x] SubTask 3.2: 实现新增 Plan 逻辑，包含自动分配排序的 Plan ID（找出最大的整数 ID 加 1，若无则设为 1）。
  - [x] SubTask 3.3: 实现逐步引导用户输入 Plan 详情（名称、BaseURL、API Key、支持模型列表以逗号分隔输入、配额限制、配额周期等）。
  - [x] SubTask 3.4: 实现修改和删除已有 Plan 的逻辑。

- [x] Task 4: 实现负载均衡和模型别名配置交互逻辑
  - [x] SubTask 4.1: 实现负载均衡（Load Balancing）策略的单选配置与权重因子的修改交互。
  - [x] SubTask 4.2: 实现模型别名（Model Aliases）的添加、编辑与删除交互。

- [x] Task 5: 验证并保存配置
  - [x] SubTask 5.1: 确保退出向导时，验证更新的 Config 数据，并调用 `saveConfig` 方法将修改写入到 `config.yaml` 中。
  - [x] SubTask 5.2: 确认构建和运行正常（执行 `npm run build`），并测试 CLI 交互与文件写入权限，确保支持 Docker 环境下的更新。

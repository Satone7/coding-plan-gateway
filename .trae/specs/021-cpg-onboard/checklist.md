# Checklist

- [x] 1. `package.json` 中已添加 TUI 交互库，且能够正常安装构建。
- [x] 2. 成功运行 `cpg onboard` 进入 TUI 交互界面，无异常报错。
- [x] 3. 在 TUI 界面中，主菜单包含管理 Plans、配置负载均衡、配置模型别名、保存并退出等选项。
- [x] 4. 新增 Plan 时，Plan ID 能够根据现有最大的整数 ID 自动递增分配。
- [x] 5. 能够通过 TUI 完整输入或修改一个 Plan 的所有支持的配置项（名称、BaseURL、API Key、模型、配额相关）。
- [x] 6. 能够通过 TUI 修改负载均衡策略（如 `quota-priority`, `round-robin`）以及对应权重。
- [x] 7. 能够通过 TUI 增删改模型别名映射。
- [x] 8. 完成所有修改后，选择保存并退出，变更能正确写入 `config.yaml` 且格式正确。
- [x] 9. 修改完后配置能顺利通过 `schema.ts` 验证并被服务加载。

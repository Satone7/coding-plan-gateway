# 修复 Plan 过期未重置消耗的 Bug

## Why
目前在设置中配置了 `expiresOn`（到期时间），但是当该时间到期时，系统并没有正确地重置相关 plan 的消耗（消耗量未清零或未重置），导致用户的额度未能如期刷新。

## What Changes
- 检查处理 `expiresOn` 逻辑的模块（如定时任务、请求拦截器或中间件）。
- 在检测到 plan 已到期（当前时间 >= `expiresOn`）时，添加清零相关 plan 消耗（如 usage、tokens 等）的逻辑。
- 根据业务需要，在重置后更新下一次的 `expiresOn`。

## Impact
- Affected specs: 用户计划与配额管理模块 (Plan & Quota Management)
- Affected code: 处理用户额度校验、扣费及过期的相关代码逻辑。

## ADDED Requirements
### Requirement: 自动重置到期的 Plan 消耗
系统 SHALL 在 plan 到期时，自动或在下一次请求时被动重置相应的消耗记录。

#### Scenario: 到期重置消耗
- **WHEN** 用户的 plan 设置了 `expiresOn`，且当前时间已经达到或超过该时间。
- **THEN** 系统应该将该 plan 的当前已使用消耗量重置为 0，恢复可用额度。

## MODIFIED Requirements
### Requirement: 额度校验前的前置检查
在执行扣除额度之前，需确保已经完成对 `expiresOn` 的检查；如果发现过期，需优先触发重置逻辑。

# Plan 选择多因素打分日志优化

## Why
当前系统在存在多个匹配模型的 Plan 时，已经支持基于剩余配额（Quota）、到期时间（Expiration）和当前请求频率（RPM）进行多因素打分平衡，并且已经配置了合理的比重（RPM=0.4, Expiration=0.4, Quota=0.2）。但在系统日志中，目前仅输出了最终被选中的 Plan 的打分信息，未输出其他候选 Plan 的得分详情，不利于在出现负载不均或请求路由疑问时进行排查和分析。

## What Changes
- 在 `quotaPriorityStrategy` 策略中，增加对所有参与打分的候选 Plan 及其得分信息的遍历记录。
- 将每个 Plan 的综合得分（`totalScore`）及其子维度得分（RPM, Expiration, Quota）作为日志上下文输出。

## Impact
- Affected specs: 负载均衡与路由策略模块
- Affected code: `src/services/plan-selector.ts`

## ADDED Requirements
### Requirement: 输出候选 Plan 的打分详情
系统 SHALL 在使用 `quota-priority` 策略评估多个候选 Plan 时，输出包含每个 Plan 得分明细的日志。

#### Scenario: 成功记录打分信息
- **WHEN** 请求路由触发基于多因素的 Plan 选择，并计算得出各候选 Plan 的得分
- **THEN** 网关应该在调试或信息级别（Debug/Info）日志中记录每个候选 Plan 的名称、ID 以及它的具体得分项（RPM得分、过期得分、配额得分）和总分。

## MODIFIED Requirements
### Requirement: 确认现有多因素比重
确认并维持目前 RPM 和过期时间占主导的比重策略（`DEFAULT_FACTOR_WEIGHTS`：expiration: 0.4, rpm: 0.4, quota: 0.2）。该要求已经满足当前业务诉求，因此不需要改动权重配置本身，只关注于日志可视化。

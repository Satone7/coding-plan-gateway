# Feature Specification: Plan Usage Statistics Enhancement

**Feature Branch**: `008-plan-usage-stats`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "完善plan的用量统计，提供手动调整usage接口，增加plan级别每日明细报表，修复cpg usage-report命令"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Plan Usage Report (Priority: P1)

As a gateway administrator, I want to view detailed usage reports for each coding plan so that I can monitor quota consumption across my subscriptions.

**Why this priority**: This is the core functionality - understanding plan usage is fundamental to managing subscriptions and quotas effectively.

**Independent Test**: Can be fully tested by running the usage report command and verifying that plan-level daily breakdowns are displayed correctly.

**Acceptance Scenarios**:

1. **Given** I have multiple coding plans with different quota limits, **When** I run `cpg usage-report --plan <plan-id>`, **Then** I see a report showing daily request counts for that specific plan
2. **Given** I have plans with usage data spanning multiple days, **When** I run `cpg usage-report --plan <plan-id> --from 2026-03-01 --to 2026-03-25`, **Then** I see only the usage data within the specified date range
3. **Given** I have no usage data for a plan, **When** I run `cpg usage-report --plan <plan-id>`, **Then** I see a message indicating no usage data found

---

### User Story 2 - Adjust Plan Usage Manually (Priority: P1)

As a gateway administrator, I want to manually adjust the usage count for a plan so that I can correct discrepancies between my actual subscription usage and the tracked usage.

**Why this priority**: Manual adjustment is critical for correcting tracking drift, which is a known risk (R-003 in architecture.md). This enables users to sync the gateway's tracked usage with actual provider usage.

**Independent Test**: Can be fully tested by adjusting usage and verifying the new value is reflected in reports and quota calculations.

**Acceptance Scenarios**:

1. **Given** a plan with current usage of 50, **When** I run `cpg plan set-usage --plan <plan-id> --count 100`, **Then** the plan's usage is set to exactly 100 requests
2. **Given** a plan with limit 200 and current usage of 50, **When** I run `cpg plan set-usage --plan <plan-id> --percent 75`, **Then** the plan's usage is set to 150 (75% of 200)
3. **Given** a plan, **When** I try to set usage to a negative value, **Then** I receive an error message indicating the value must be non-negative
4. **Given** a plan, **When** I try to set usage that exceeds the quota limit, **Then** I receive a warning but the adjustment is still applied (allowing users to track overage)

---

### User Story 3 - List All Plans with Usage Summary (Priority: P2)

As a gateway administrator, I want to see a summary of usage across all plans so that I can quickly understand my overall subscription utilization.

**Why this priority**: This provides a high-level overview that helps users make informed decisions about subscription management.

**Independent Test**: Can be fully tested by running the list command and verifying all plans are displayed with their usage statistics.

**Acceptance Scenarios**:

1. **Given** I have multiple coding plans configured, **When** I run `cpg plan list`, **Then** I see a table showing each plan's name, limit, used count, and remaining quota
2. **Given** I have plans with different quota periods (daily, monthly, total), **When** I run `cpg plan list`, **Then** each plan shows its quota period and next reset date if applicable

---

### User Story 4 - Fix Usage Report Command (Priority: P1)

As a gateway administrator, I want the `cpg usage-report` command to work correctly so that I can view my API key usage without errors.

**Why this priority**: The command is currently broken and blocks users from viewing any usage data, making this a blocking issue.

**Independent Test**: Can be fully tested by running the command and verifying the output is properly formatted.

**Acceptance Scenarios**:

1. **Given** I have API keys with usage data, **When** I run `cpg usage-report`, **Then** I see a properly formatted table with key IDs, names, request counts, and token usage
2. **Given** I have usage data, **When** I run `cpg usage-report --json`, **Then** I see valid JSON output with all usage data

---

### Edge Cases

- What happens when a plan's limit changes after usage has been recorded? (Usage percentage should recalculate based on new limit)
- How does the system handle usage adjustment when the plan has daily/monthly reset scheduled? (Adjustment should not affect reset schedule)
- What happens when trying to adjust usage for a non-existent plan? (Return clear error message)
- How are partial days handled in daily reports? (Include all activity for the day up to the current time)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST track daily request counts per plan with date granularity
- **FR-002**: System MUST persist plan usage data across restarts
- **FR-003**: Users MUST be able to view plan-level usage reports via CLI command
- **FR-004**: Users MUST be able to filter plan usage reports by date range
- **FR-005**: Users MUST be able to set plan usage to an exact count value
- **FR-006**: Users MUST be able to set plan usage as a percentage of quota limit
- **FR-007**: System MUST validate that usage values are non-negative
- **FR-008**: System MUST display warning when setting usage exceeds quota limit
- **FR-009**: System MUST display plan usage summary including limit, used, remaining, and percentage
- **FR-010**: System MUST fix the `cpg usage-report` command formatting issues
- **FR-011**: System MUST support both table and JSON output formats for plan reports
- **FR-012**: System MUST show quota period and next reset date for plans with daily/monthly periods
- **FR-013**: System MUST allow filtering usage reports by plan ID

### Key Entities

- **PlanUsageRecord**: Daily usage record for a plan containing date, request count, and last updated timestamp
- **PlanUsageReport**: Aggregated usage report for a plan with date range, total requests, and daily breakdown
- **UsageAdjustmentRequest**: Request to modify a plan's usage with either count or percentage value

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can retrieve plan usage reports in under 2 seconds for plans with up to 90 days of data
- **SC-002**: Usage adjustment commands complete in under 1 second
- **SC-003**: 100% of plan usage data persists correctly across gateway restarts
- **SC-004**: The `cpg usage-report` command produces correctly formatted output 100% of the time
- **SC-005**: Users can successfully adjust plan usage via both count and percentage methods without errors
- **SC-006**: Plan usage reports accurately reflect daily request counts with no data loss

## Assumptions

- Usage tracking continues to count requests only (not tokens) for plan-level tracking
- API key-level usage tracking (tokens, input/output breakdown) remains separate and unchanged
- Users are responsible for verifying their adjustments against actual provider usage
- The existing file-based storage pattern (JSON files) is sufficient for plan usage persistence
- Single-user local deployment means no concurrent modification protection is needed
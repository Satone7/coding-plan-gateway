# Feature Specification: Fix Usage Tracking Issues

**Feature Branch**: `011-fix-usage-tracking`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "创建一个新feature，解决issues.md中的问题"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correct Quota Reset Date Display (Priority: P1)

As a system administrator, I want the usage report to display the correct quota reset date based on the plan's `expiresOn` configuration, so that I can accurately predict when my plan quota will reset.

**Why this priority**: This is a display bug that causes confusion. Users see incorrect reset dates, leading to poor planning decisions. It affects trust in the system's reporting accuracy.

**Independent Test**: Can be fully tested by configuring a plan with `expiresOn: 27`, running `cpg usage-report --plan <id>`, and verifying the reset date shows the 27th of the month (or next month if past the 27th).

**Acceptance Scenarios**:

1. **Given** a plan configured with `expiresOn: 27` and `period: monthly`, **When** I run `cpg usage-report --plan <id>` on March 15th, **Then** the reset date displays as `2026-03-27 00:00:00`
2. **Given** a plan configured with `expiresOn: 27` and `period: monthly`, **When** I run `cpg usage-report --plan <id>` on March 28th, **Then** the reset date displays as `2026-04-27 00:00:00`
3. **Given** a plan configured with `expiresOn: 31` and `period: monthly`, **When** I run the report in February (28 days), **Then** the reset date displays as `2026-02-28 00:00:00` (last day of month)
4. **Given** a plan without `expiresOn` configured, **When** I run the usage report, **Then** the reset date defaults to the 1st of next month (current behavior preserved)

---

### User Story 2 - Consistent Usage Values Across Systems (Priority: P1)

As a system administrator, when I manually adjust plan usage via `set-usage`, I want the adjustment to be reflected in both the usage reports AND the quota routing decisions, so that I can trust the system to route requests correctly based on the adjusted values.

**Why this priority**: This is a data consistency issue with medium severity. It can lead to over/under utilization of plans and causes confusion when reports show one value while routing uses another.

**Independent Test**: Can be fully tested by setting usage via CLI, making a request through the gateway, and verifying both the usage report and routing behavior reflect the adjusted value.

**Acceptance Scenarios**:

1. **Given** a running server with plan usage at 50, **When** I run `cpg plan set-usage --id 1 --count 100`, **Then** both `usage-report` and routing quota checks reflect usage of 100
2. **Given** usage set to 100 via `set-usage`, **When** I make 5 new requests through the gateway, **Then** the usage report shows 105 (100 + 5)
3. **Given** a plan with limit 200 and usage set to 180 via `set-usage`, **When** I make 30 requests, **Then** only 20 requests succeed (limit - adjusted usage = 20 remaining)
4. **Given** usage adjusted multiple times on the same day, **When** I check the usage report, **Then** the final value reflects the last adjustment correctly

---

### User Story 3 - Unified Usage Data Source (Priority: P2)

As a system administrator, I want a single authoritative source for usage data, so that I don't encounter discrepancies between different parts of the system.

**Why this priority**: This addresses the root cause of Issue 002 by consolidating two separate tracking systems into one, improving maintainability and reducing complexity.

**Independent Test**: Can be fully tested by verifying that all usage queries (reports, routing, CLI commands) read from and write to the same underlying data store.

**Acceptance Scenarios**:

1. **Given** the unified usage system, **When** I check usage via any method (CLI, API, routing check), **Then** all methods return the same value
2. **Given** server restart, **When** the system initializes, **Then** usage is restored from the single persisted source
3. **Given** historical daily records exist, **When** I view a usage report with date range, **Then** daily breakdown is still available

---

### Edge Cases

- What happens when `expiresOn` is set to a value greater than the days in the current month (e.g., 31 in February)? The system should use the last day of the month.
- What happens when `set-usage` is called with a value exceeding the quota limit? The system should accept it but display a warning.
- What happens when usage is set to a lower value than the current day's request count? The system should update to the new value, potentially creating a negative delta for the day's record.
- What happens if both `expiresOn` and `expiresAt` are configured? `expiresAt` takes precedence as specified in existing behavior.
- What happens when `set-usage` is called while the server is not running? The CLI should update the persistent store directly, and the server should load the updated value on startup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The usage report command MUST display the correct quota reset date based on the plan's `expiresOn` configuration when specified.
- **FR-002**: When `expiresOn` is not configured, the usage report MUST default to the 1st of the next month for monthly plans (preserving current behavior).
- **FR-003**: For months with fewer days than the configured `expiresOn` value, the system MUST use the last day of the month.
- **FR-004**: The `set-usage` command MUST update the usage value used by quota routing decisions.
- **FR-005**: After `set-usage` is executed, subsequent requests MUST correctly increment from the adjusted value.
- **FR-006**: The system MUST maintain a single authoritative source for current usage per plan.
- **FR-007**: Historical daily usage records MUST be preserved for reporting purposes.
- **FR-008**: The `expiresOn` field MUST be respected in both CLI usage reports and API usage reports.
- **FR-009**: Usage adjustments MUST persist across server restarts.
- **FR-010**: When the server is running, `set-usage` MUST immediately affect routing decisions without requiring a server restart.

### Key Entities

- **Usage State**: The current usage count per plan, serving as the authoritative source for routing decisions and reports.
- **Daily Usage Record**: Historical record of requests per plan per day, used for breakdown reports and trend analysis.
- **Expiration Configuration**: Plan-level setting (`expiresOn` or `expiresAt`) that determines when quota resets.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Usage reports display the correct reset date matching the `expiresOn` configuration in 100% of test cases.
- **SC-002**: After `set-usage`, the reported usage and routing quota checks return identical values within 1 second.
- **SC-003**: New requests after `set-usage` increment correctly from the adjusted value with zero drift.
- **SC-004**: System maintains accurate usage tracking with no data loss during normal operation.
- **SC-005**: All existing tests continue to pass after the fix is implemented.

## Assumptions

- The existing `calculateEffectiveExpiration` utility in `src/utils/expiration.ts` will be reused for reset date calculations.
- The `PlanUsageTracker` will become the single source of truth for usage data.
- `QuotaManager` will query `PlanUsageTracker` for current usage rather than maintaining its own counter.
- The CLI can operate independently of the running server by reading/writing the same persistent storage.
- Migration from the current dual-system to single-system will not require data migration scripts (existing data will be compatible).
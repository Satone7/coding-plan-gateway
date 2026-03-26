# Feature Specification: Plan ID Integer Optimization

**Feature Branch**: `010-plan-id-int`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "优化plan的id，不要使用uuid，而是直接使用整数，如1,2,3"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Plans with Simple Integer IDs (Priority: P1)

As a user managing multiple AI coding plans, I want newly created plans to have simple integer IDs (1, 2, 3...) so that I can easily reference and remember them in commands and API calls.

**Why this priority**: This is the core functionality - changing the ID format from UUID to integer. Without this, the feature has no value.

**Independent Test**: Can be fully tested by creating a new plan and verifying it receives ID 1 (or next available integer), then creating another and verifying it receives ID 2.

**Acceptance Scenarios**:

1. **Given** no existing plans, **When** I create a new plan, **Then** the plan is assigned ID 1
2. **Given** plans with IDs 1, 2, 3 exist, **When** I create a new plan, **Then** the plan is assigned ID 4
3. **Given** plans with IDs 1, 3 exist (ID 2 was deleted), **When** I create a new plan, **Then** the plan is assigned ID 4 (auto-increment, no reuse)
4. **Given** I create a plan via API, **When** I provide a specific integer ID, **Then** the system rejects it and auto-assigns the next available ID

---

### User Story 2 - Reference Plans by Integer ID (Priority: P1)

As a user, I want to reference plans using simple integer IDs (e.g., "plan 1", "plan 2") in all API calls and CLI commands so that interactions are more intuitive and less error-prone.

**Why this priority**: This enables the primary user benefit - easier plan management through simple IDs.

**Independent Test**: Can be fully tested by making API calls to `/api/plans/1`, `/api/quota/1/reset` and verifying correct plan is accessed.

**Acceptance Scenarios**:

1. **Given** a plan with ID 5 exists, **When** I call `GET /api/plans/5`, **Then** the correct plan details are returned
2. **Given** a plan with ID 2 exists, **When** I call `POST /api/quota/2/reset`, **Then** quota is reset for the correct plan
3. **Given** a plan with ID 3 exists, **When** I call `DELETE /api/plans/3`, **Then** the correct plan is removed
4. **Given** no plan with ID 999 exists, **When** I call `GET /api/plans/999`, **Then** a 404 error is returned with clear message

---

### User Story 3 - Migrate Existing Plans from UUID to Integer (Priority: P2)

As an existing user with plans already configured using UUID IDs, I want my plans to be automatically migrated to use integer IDs so that I don't lose my configuration when upgrading.

**Why this priority**: Ensures existing users can upgrade without manual intervention. Lower than P1 because it only affects users upgrading from older versions.

**Independent Test**: Can be fully tested by starting with a config file containing UUID-based plan IDs and verifying they are converted to integers after upgrade.

**Acceptance Scenarios**:

1. **Given** existing config with plans using UUID IDs, **When** the system starts after upgrade, **Then** all plans are assigned sequential integer IDs (1, 2, 3...)
2. **Given** existing quota state file with UUID-based plan IDs, **When** migration completes, **Then** quota states are mapped to the new integer IDs
3. **Given** migration has occurred, **When** I check the logs, **Then** a migration log entry shows the UUID-to-integer mapping for audit purposes
4. **Given** migration fails midway, **When** the system encounters an error, **Then** the original config is preserved and an error is logged

---

### User Story 4 - View Plan ID in Logs and Metrics (Priority: P3)

As a user debugging or monitoring the system, I want to see simple integer IDs in logs and metrics so that I can quickly identify which plan is being referenced.

**Why this priority**: Improves operational visibility but is not essential for core functionality.

**Independent Test**: Can be fully tested by making API requests and verifying logs show integer plan IDs instead of UUIDs.

**Acceptance Scenarios**:

1. **Given** a request is routed to plan 3, **When** I check the request log, **Then** I see `planId: 3` instead of a UUID
2. **Given** quota is consumed for plan 2, **When** I check the quota log, **Then** I see `planId: 2`
3. **Given** an error occurs for plan 1, **When** I check the error log, **Then** I see `planId: 1` for quick identification

---

### Edge Cases

- What happens when the maximum safe integer (2^53-1) is reached? System should handle this gracefully by rejecting new plan creation with a clear error message.
- How does the system handle concurrent plan creation? The ID assignment must be atomic to prevent duplicate IDs.
- What happens if a plan ID is specified in the request body during creation? The system should ignore it or reject the request and auto-assign the next ID.
- How does the system handle importing a config file with manually specified integer IDs that have gaps? The system should accept gaps but continue auto-increment from the highest existing ID.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST assign sequential integer IDs to newly created plans starting from 1
- **FR-002**: System MUST auto-increment the plan ID for each new plan creation
- **FR-003**: System MUST NOT reuse deleted plan IDs (no gap filling)
- **FR-004**: System MUST accept integer IDs in URL path parameters for plan operations (GET, PUT, DELETE)
- **FR-005**: System MUST reject manual ID specification during plan creation (auto-assignment only)
- **FR-006**: System MUST migrate existing UUID-based plan IDs to integer IDs on first startup after upgrade
- **FR-007**: System MUST preserve the UUID-to-integer mapping in a migration log during upgrade
- **FR-008**: System MUST reject plan creation if the next ID would exceed the maximum safe integer (2^53-1)
- **FR-009**: System MUST ensure ID assignment is atomic to prevent race conditions during concurrent creation
- **FR-010**: System MUST return 404 Not Found for non-existent plan IDs with a clear error message
- **FR-011**: System MUST persist the highest used ID to maintain correct auto-increment across restarts
- **FR-012**: System MUST update all internal references (quota tracking, RPM tracking, logs) to use integer IDs

### Key Entities

- **Plan**: Represents an AI coding plan subscription. Has a unique integer identifier (id: number), name, provider URL, API key, supported models, quota configuration, timeout, and status. The integer ID is auto-assigned and immutable after creation.
- **PlanIdCounter**: Tracks the highest assigned plan ID to ensure correct auto-increment. Persisted to prevent ID collision after restart.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can reference any plan using a 1-3 digit number instead of a 36-character UUID, reducing ID input time by 90%+
- **SC-002**: All existing users with UUID-based configs complete migration to integer IDs within 1 second on first startup after upgrade
- **SC-003**: API response times for plan operations remain unchanged (<50ms routing overhead)
- **SC-004**: Zero data loss occurs during migration - all plan configurations and quota states are preserved
- **SC-005**: 100% of API endpoints accepting plan IDs work correctly with integer format

## Assumptions

- The maximum number of plans a single user will manage is well below 2^53-1 (9,007,199,254,740,991), making integer IDs practical
- Users accept that deleted plan IDs will not be reused (historical audit trail preserved)
- Migration from UUID to integer is one-way; there is no requirement to convert back to UUIDs
- All plan references in the codebase currently use string types for IDs and will need type updates
- The system remains single-user local deployment, so ID collision risks are minimal
# Feature Specification: API Key Management

**Feature Branch**: `005-api-key-management`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "开发新feature，新增api key的校验机制，并且提供命令创建api key，运行时分别统计不同api key的用量并持久化，提供命令随时查询用量报表。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - API Key Validation (Priority: P1)

As a gateway administrator, I want to validate API keys on incoming requests so that only authorized clients can access the gateway.

**Why this priority**: Security is foundational - without authentication, usage tracking and reporting are meaningless as any client could access the system.

**Independent Test**: Can be fully tested by creating a valid API key, sending requests with and without valid keys, and verifying that only valid keys are accepted.

**Acceptance Scenarios**:

1. **Given** a valid API key exists in the system, **When** a request includes the correct Authorization header, **Then** the request is processed normally.
2. **Given** no valid API keys match the provided key, **When** a request includes an invalid Authorization header, **Then** the request is rejected with 401 Unauthorized.
3. **Given** no Authorization header is present, **When** a request is received, **Then** the request is rejected with 401 Unauthorized.
4. **Given** a disabled API key, **When** a request uses that key, **Then** the request is rejected with 403 Forbidden.

---

### User Story 2 - API Key Creation via CLI (Priority: P2)

As a gateway administrator, I want to create and manage API keys using CLI commands so that I can control access to the gateway.

**Why this priority**: Key management is essential for administering the authentication system after validation is in place.

**Independent Test**: Can be fully tested by running CLI commands to create, list, enable/disable, and delete API keys, verifying each operation succeeds.

**Acceptance Scenarios**:

1. **Given** the CLI is available, **When** I run the create-key command with a name, **Then** a new API key is generated and displayed.
2. **Given** multiple API keys exist, **When** I run the list-keys command, **Then** all keys are displayed with their metadata (name, prefix, created date, status).
3. **Given** an existing API key, **When** I run the disable-key command with the key ID, **Then** the key status changes to disabled.
4. **Given** an existing API key, **When** I run the delete-key command with the key ID, **Then** the key is permanently removed.

---

### User Story 3 - Usage Tracking and Persistence (Priority: P3)

As a gateway administrator, I want the system to track API usage per key and persist it so that usage data survives restarts.

**Why this priority**: Usage tracking provides value after the system is operational with authenticated access.

**Independent Test**: Can be fully tested by making multiple requests with different API keys, restarting the service, and verifying usage counts persist.

**Acceptance Scenarios**:

1. **Given** a valid API key makes a successful request, **When** the request completes, **Then** the request count for that key is incremented.
2. **Given** a request with streaming response, **When** streaming completes, **Then** token usage is recorded for the API key.
3. **Given** usage data has been recorded, **When** the service restarts, **Then** previously recorded usage data is available.
4. **Given** multiple API keys are in use, **When** usage is tracked, **Then** each key maintains separate usage counters.

---

### User Story 4 - Usage Report Query (Priority: P4)

As a gateway administrator, I want to query usage reports via CLI commands so that I can monitor consumption per API key.

**Why this priority**: Reporting is a convenience feature that depends on tracking data being collected.

**Independent Test**: Can be fully tested by generating usage with multiple keys, then running report commands and verifying accurate data is displayed.

**Acceptance Scenarios**:

1. **Given** usage has been recorded for multiple API keys, **When** I run the usage-report command, **Then** a summary shows usage per key (requests, tokens, dates).
2. **Given** usage data exists, **When** I run the usage-report command with a date range filter, **Then** only usage within that range is included.
3. **Given** usage data exists, **When** I run the usage-report command with a specific key filter, **Then** only that key's usage is shown.
4. **Given** no usage exists for the specified criteria, **When** I run the usage-report command, **Then** an empty report is displayed with appropriate message.

---

### Edge Cases

- What happens when an API key reaches a configured rate limit? Request is rejected with 429 Too Many Requests.
- How does the system handle corrupted usage data files on startup? Log error, start fresh with zero counts, preserve existing valid data.
- What happens if usage persistence fails? Log error, continue operation, retry on next sync interval.
- How are API keys stored securely? Keys are hashed using bcrypt, only the prefix (first 8 characters) is stored in plain text for identification.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST validate API keys on all API endpoints (except health checks and CLI commands).
- **FR-002**: System MUST support Bearer token authentication via the Authorization header.
- **FR-003**: System MUST provide CLI commands for creating, listing, enabling/disabling, and deleting API keys.
- **FR-004**: System MUST generate cryptographically secure random API keys with a configurable prefix.
- **FR-005**: System MUST track request count and token usage per API key.
- **FR-006**: System MUST persist usage data to a separate JSON file (usage-data.json) with periodic sync.
- **FR-006a**: System MUST store API keys in a separate JSON file (api-keys.json) with key hashes only.
- **FR-007**: System MUST provide CLI commands for querying usage reports with filtering options.
- **FR-008**: System MUST store API key hashes (not plaintext) for security.
- **FR-009**: System MUST support key expiration dates (optional configuration).
- **FR-010**: System MUST allow exempting certain endpoints from authentication (configurable).

### Key Entities

- **API Key**: Represents a client credential with attributes: ID (UUID format), name, key string (prefixed random format, e.g., `cpg_xxxxxxxxxxxx`), key hash (bcrypt), prefix (first 8 chars for identification), creation date, expiration date (optional), status (active/disabled).
- **Usage Record**: Represents daily aggregated usage metrics for an API key with attributes: key ID, date (YYYY-MM-DD), request count, input token count, output token count, last request timestamp.
- **Usage Report**: Aggregated view of usage data with attributes: key ID, key name, total requests, total tokens, date range, breakdown by period.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: API key validation completes in under 5 milliseconds per request.
- **SC-002**: Usage tracking adds no more than 10 milliseconds latency to request processing.
- **SC-003**: Usage data persists within 60 seconds of being recorded (sync interval).
- **SC-004**: CLI commands for key management complete in under 1 second.
- **SC-005**: Usage report generation completes in under 2 seconds for up to 10,000 records.
- **SC-006**: Zero plaintext API keys stored in any persistent storage.
- **SC-007**: Service restarts with zero loss of persisted usage data.

## Clarifications

### Session 2026-03-24

- Q: What format should the API Key ID be? → A: UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000)
- Q: What format should the generated API Key string be? → A: Prefixed random string (e.g., `cpg_xxxxxxxxxxxx`)
- Q: Where should API Keys be stored? → A: Separate JSON file (e.g., `api-keys.json`)
- Q: What granularity should usage data be aggregated by? → A: Daily aggregation (one record per day per API key)
- Q: What format should usage data be persisted in? → A: Separate JSON file (e.g., `usage-data.json`)

## Assumptions

- Single-user local deployment means no multi-tenancy or role-based access control is needed.
- API keys are long-lived by default; expiration is optional.
- Usage data is tracked for monitoring purposes, not billing.
- Rate limiting per key is a future enhancement, not included in this feature.
- Token counting relies on upstream provider response data when available.
- File-based storage is sufficient for expected usage volume (thousands of records, not millions).
# Feature Specification: Fix CLI Reload and Key Persistence

**Feature Branch**: `007-fix-cli-reload`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Fix CLI reload endpoint and key persistence issues found during manual testing"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Immediate Key Availability (Priority: P1)

A DevOps engineer creates an API key using the CLI and needs to use it immediately for authentication with Claude Code, without restarting the gateway service.

**Why this priority**: This is the core user workflow that is currently broken. Users cannot use created keys until they manually restart the gateway, making the CLI effectively useless for production key management.

**Independent Test**: Can be fully tested by creating a key via `cpg key create` and immediately using it for an API request, verifying authentication succeeds without any gateway restart.

**Acceptance Scenarios**:

1. **Given** the gateway is running, **When** I create a key via `cpg key create --name "Test"`, **Then** the key is immediately valid and `cpg key test <key>` returns "valid"
2. **Given** a key was just created via CLI, **When** I use it as the API key for Claude Code, **Then** Claude Code successfully authenticates and receives a valid AI response
3. **Given** the gateway received a reload notification, **When** it processes the reload request, **Then** it returns `{ "success": true }` and reloads keys from storage

---

### User Story 2 - Key Persistence Across Restarts (Priority: P2)

A system administrator creates API keys and expects them to persist when the Docker container is restarted for maintenance or updates.

**Why this priority**: Key persistence is essential for production reliability. Users should not lose all their keys during routine container restarts or deployments.

**Independent Test**: Can be fully tested by creating a key, running `docker compose down && docker compose up`, then running `cpg key list` to verify the key still exists.

**Acceptance Scenarios**:

1. **Given** I created a key and the container was restarted (without `-v` flag), **When** I run `cpg key list`, **Then** the key is still present in the list
2. **Given** a key persisted from a previous session, **When** I test it with `cpg key test <key>`, **Then** it returns "valid" and can authenticate API requests
3. **Given** the container volume exists, **When** I inspect `/app/data/api-keys.json`, **Then** it contains the previously created keys

---

### User Story 3 - E2E Test Compatibility (Priority: P3)

A developer runs the E2E test suite and expects all tests to pass, validating that the complete system works end-to-end including CLI key creation and Claude Code authentication.

**Why this priority**: Passing E2E tests validate the entire system integration. This is critical for confidence in deployments but depends on fixing P1 and P2 first.

**Independent Test**: Can be fully tested by running the E2E test suite (`npm run test:e2e`) and verifying all tests pass, particularly `docker exec claude-code claude -p "hello"` returns a valid response.

**Acceptance Scenarios**:

1. **Given** the E2E environment is running with a valid coding plan, **When** I run `docker exec claude-code claude -p "hello"`, **Then** I receive a valid AI response within 60 seconds
2. **Given** the E2E test suite is executed, **When** all tests complete, **Then** the exit code is 0 (all tests pass)
3. **Given** a key is created in the E2E environment, **When** Claude Code uses it for authentication, **Then** the request succeeds and returns a response from the AI model

---

### Edge Cases

- What happens when the reload endpoint is called multiple times in quick succession? The gateway should handle concurrent reload requests gracefully.
- What happens when the storage file is corrupted? The gateway should handle read errors without crashing.
- What happens when the Docker volume mount fails? The gateway should log a clear error about being unable to write keys.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST register the `/internal/reload` endpoint with the Fastify application during startup
- **FR-002**: System MUST exempt `/internal/*` routes from authentication requirements
- **FR-003**: System MUST reload API keys from storage when receiving a valid `POST /internal/reload` request
- **FR-004**: System MUST persist API keys to the Docker named volume at `/app/data/api-keys.json`
- **FR-005**: System MUST make newly created API keys immediately available for authentication after CLI creation
- **FR-006**: System MUST preserve API keys across container restarts when using named Docker volumes
- **FR-007**: CLI MUST notify the gateway via `/internal/reload` after key creation, modification, or deletion
- **FR-008**: System MUST return a clear error message if key persistence fails

### Key Entities

- **API Key**: Represents an authentication credential with properties: id, name, prefix, status, createdAt, expiresAt. Stored in `/app/data/api-keys.json` within the Docker named volume.
- **Reload Request**: Internal API request with type field (api-keys, usage, or all) that triggers the gateway to refresh its in-memory state from persistent storage.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `POST /internal/reload` returns HTTP 200 with `{ "success": true }` when the endpoint is properly registered
- **SC-002**: API keys created via CLI are valid for authentication within 5 seconds of creation (no restart required)
- **SC-003**: API keys persist across `docker compose down && docker compose up` cycles (without `-v` flag)
- **SC-004**: E2E test suite completes with 0 failing tests
- **SC-005**: Claude Code successfully authenticates with a key created via `docker exec gateway cpg key create`
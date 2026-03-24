# Implementation Tasks: API Key Management

**Feature**: 005-api-key-management
**Branch**: `005-api-key-management`
**Generated**: 2026-03-24

## Overview

Implement API key authentication and usage tracking for the Coding Plan Gateway. This feature adds a security layer that validates API keys on all incoming requests, provides CLI commands for key management, tracks per-key usage metrics, and persists usage data with daily aggregation.

**Context**: 每个开发阶段后都要安排验证任务 (Verification tasks after each development phase)

---

## Phase 1: Setup

**Goal**: Initialize project dependencies and configuration for API key management.

### Tasks

- [X] T001 Install bcrypt and @types/bcrypt dependencies for key hashing
- [X] T002 Add API_KEY_PREFIX constant (value: `cpg_`) to src/config/defaults.ts
- [X] T003 Add auth-related environment variables to src/config/defaults.ts (API_KEYS_PATH, USAGE_DATA_PATH, AUTH_EXEMPT_PATHS, USAGE_SYNC_INTERVAL)
- [X] T004 Add npm scripts to package.json for key management commands (key:create, key:list, key:disable, key:enable, key:delete, usage:report)
- [X] T005 Run `npm install` to ensure dependencies are installed

### Verification

- [X] T006 Verify bcrypt package is correctly installed by running `npm list bcrypt`
- [X] T007 Verify npm scripts are registered by running `npm run key:list --help` (should show command help or usage)
- [X] T008 Verify environment variable defaults by checking src/config/defaults.ts exports all auth config values

---

## Phase 2: Foundational

**Goal**: Create core types, utilities, and configuration that all user stories depend on.

### Tasks

- [X] T009 [P] Create ApiKey interface in src/types/api-key.ts with fields: id, name, keyHash, prefix, status, createdAt, expiresAt, lastUsedAt
- [X] T010 [P] Create UsageRecord interface in src/types/usage.ts with fields: keyId, date, requestCount, inputTokens, outputTokens, lastRequest
- [X] T011 [P] Create UsageReport interface in src/types/usage.ts with aggregated metrics
- [X] T012 [P] Create Zod schemas for API key validation in src/types/api-key.ts
- [X] T013 [P] Create Zod schemas for usage data validation in src/types/usage.ts
- [X] T014 Export new types from src/types/index.ts
- [X] T015 Implement generateKeyString() function in src/utils/key-generator.ts - generates `cpg_` prefix + 32 random alphanumeric chars
- [X] T016 Implement generateKeyPrefix() function in src/utils/key-generator.ts - extracts first 8 chars after prefix
- [X] T017 Create auth configuration loader in src/config/auth-config.ts with environment variable parsing

### Verification

- [X] T018 Verify type exports by running TypeScript compilation: `npm run build` or `tsc --noEmit`
- [X] T019 Verify key generator produces valid format by creating a quick test script or unit test
- [X] T020 Verify auth config correctly reads environment variables with test values

---

## Phase 3: User Story 1 - API Key Validation (P1)

**Story**: As a gateway administrator, I want to validate API keys on incoming requests so that only authorized clients can access the gateway.

**Independent Test Criteria**:
- Create a valid API key manually in storage
- Send request with valid key → request processed (200)
- Send request with invalid key → rejected (401)
- Send request without key → rejected (401)
- Send request with disabled key → rejected (403)

### Tasks

- [X] T021 [US1] Create ApiKeyManager class in src/services/api-key-manager.ts with loadKeys() method
- [X] T022 [US1] Implement key storage file path configuration (API_KEYS_PATH env var)
- [X] T023 [US1] Implement createKey() method in ApiKeyManager - generates key, hashes it, stores metadata
- [X] T024 [US1] Implement validateKey() method in ApiKeyManager - bcrypt comparison against stored hashes
- [X] T025 [US1] Implement getKeyById() and getKeyByPrefix() lookup methods
- [X] T026 [US1] Implement updateKeyStatus() method for enable/disable functionality
- [X] T027 [US1] Implement deleteKey() method
- [X] T028 [US1] Implement persistKeys() method with atomic file write
- [X] T029 [US1] Create authentication middleware in src/middleware/auth.ts with Bearer token extraction
- [X] T030 [US1] Implement exemption path matching in auth middleware (health, ready endpoints)
- [X] T031 [US1] Add auth middleware hook registration in src/app.ts (preHandler hook)
- [X] T032 [US1] Add 401 Unauthorized error response format matching OpenAI/Anthropic style
- [X] T033 [US1] Add 403 Forbidden error response for disabled keys
- [X] T034 [US1] Initialize ApiKeyManager on startup in src/index.ts

### Verification

- [X] T035 [US1] Write unit tests for ApiKeyManager.validateKey() in tests/unit/services/api-key-manager.test.ts
- [X] T036 [US1] Write unit tests for auth middleware in tests/unit/middleware/auth.test.ts
- [X] T037 [US1] Write integration test for valid key authentication flow in tests/integration/auth-flow.test.ts
- [X] T038 [US1] Write integration test for invalid key rejection (401) in tests/integration/auth-flow.test.ts
- [X] T039 [US1] Write integration test for missing auth header (401) in tests/integration/auth-flow.test.ts
- [X] T040 [US1] Write integration test for disabled key rejection (403) in tests/integration/auth-flow.test.ts
- [X] T041 [US1] Run all tests and verify: `npm test`
- [X] T042 [US1] Manual verification: Create a test key, make curl request with valid/invalid keys

---

## Phase 4: User Story 2 - API Key Creation via CLI (P2)

**Story**: As a gateway administrator, I want to create and manage API keys using CLI commands so that I can control access to the gateway.

**Independent Test Criteria**:
- Run `npm run key:create -- --name "Test"` → key generated and displayed
- Run `npm run key:list` → all keys shown with metadata
- Run `npm run key:disable -- --id <uuid>` → key status changes to disabled
- Run `npm run key:enable -- --id <uuid>` → key status changes to active
- Run `npm run key:delete -- --id <uuid>` → key removed permanently

### Tasks

- [X] T043 [US2] Create scripts/api-key.ts CLI entry point with command routing
- [X] T044 [US2] Implement `create` command in src/cli/api-key-cli.ts - prompt for name, generate key, display result
- [X] T045 [US2] Implement `list` command in src/cli/api-key-cli.ts - display all keys in table format
- [X] T046 [US2] Implement `disable` command in src/cli/api-key-cli.ts - change key status to disabled
- [X] T047 [US2] Implement `enable` command in src/cli/api-key-cli.ts - change key status to active
- [X] T048 [US2] Implement `delete` command in src/cli/api-key-cli.ts - remove key with confirmation
- [X] T049 [US2] Add CLI help text and usage examples for each command
- [X] T050 [US2] Add error handling for missing required arguments (e.g., --name for create, --id for others)
- [X] T051 [US2] Create internal API route handlers in src/routes/admin/api-keys.ts for CLI commands to use
- [X] T052 [US2] Register internal API routes in src/routes/index.ts (under /internal/keys)

### Verification

- [X] T053 [US2] Write contract tests for CLI commands in tests/contract/api-key-cli.test.ts
- [X] T054 [US2] Test create command: `npm run key:create -- --name "CLI Test Key"` - verify key is created
- [X] T055 [US2] Test list command: `npm run key:list` - verify all keys are displayed
- [X] T056 [US2] Test disable command: `npm run key:disable -- --id <created-key-id>` - verify status changes
- [X] T057 [US2] Test enable command: `npm run key:enable -- --id <created-key-id>` - verify status changes back
- [X] T058 [US2] Test delete command: `npm run key:delete -- --id <created-key-id>` - verify key is removed
- [X] T059 [US2] Test error handling: Run commands without required args and verify error messages

---

## Phase 5: User Story 3 - Usage Tracking and Persistence (P3)

**Story**: As a gateway administrator, I want the system to track API usage per key and persist it so that usage data survives restarts.

**Independent Test Criteria**:
- Make requests with valid API key → request count increments
- Make streaming request → token usage is recorded
- Restart the service → usage data persists
- Use multiple API keys → each maintains separate counters

### Tasks

- [X] T060 [US3] Create UsageTracker class in src/services/usage-tracker.ts with in-memory storage
- [X] T061 [US3] Implement incrementRequestCount() method with date-based aggregation
- [X] T062 [US3] Implement recordTokenUsage() method for input/output tokens
- [X] T063 [US3] Implement persistUsage() method with atomic file write to usage-data.json
- [X] T064 [US3] Implement loadUsage() method to restore data on startup
- [X] T065 [US3] Implement periodic sync with configurable interval (USAGE_SYNC_INTERVAL)
- [X] T066 [US3] Modify auth middleware to track authenticated requests in UsageTracker
- [X] T067 [US3] Modify request handlers to extract token usage from upstream responses
- [X] T068 [US3] Add token extraction for OpenAI format responses (usage.prompt_tokens, usage.completion_tokens)
- [X] T069 [US3] Add token extraction for Anthropic format responses (usage.input_tokens, usage.output_tokens)
- [X] T070 [US3] Handle streaming responses - accumulate SSE events for token data
- [X] T071 [US3] Initialize UsageTracker on startup in src/index.ts
- [X] T072 [US3] Add graceful shutdown handler to persist final usage data

### Verification

- [X] T073 [US3] Write unit tests for UsageTracker in tests/unit/services/usage-tracker.test.ts
- [X] T074 [US3] Write test for request count increment on authenticated request
- [X] T075 [US3] Write test for token extraction from OpenAI response format
- [X] T076 [US3] Write test for token extraction from Anthropic response format
- [X] T077 [US3] Write test for usage data persistence across service restart
- [X] T078 [US3] Write test for multiple API keys maintaining separate counters
- [X] T079 [US3] Run all tests: `npm test`
- [X] T080 [US3] Manual verification: Make multiple requests, restart service, verify counts persist

---

## Phase 6: User Story 4 - Usage Report Query (P4)

**Story**: As a gateway administrator, I want to query usage reports via CLI commands so that I can monitor consumption per API key.

**Independent Test Criteria**:
- Run `npm run usage:report` → summary shows usage per key
- Run `npm run usage:report -- --key-id <uuid>` → only that key's usage
- Run `npm run usage:report -- --from 2026-01-01 --to 2026-03-31` → date-filtered results
- Run with no usage data → empty report with appropriate message

### Tasks

- [ ] T081 [US4] Implement getUsageReport() method in UsageTracker with filtering options
- [ ] T082 [US4] Implement date range filtering (from, to parameters)
- [ ] T083 [US4] Implement key ID filtering
- [ ] T084 [US4] Implement daily breakdown aggregation
- [ ] T085 [US4] Implement `report` command in src/cli/api-key-cli.ts
- [ ] T086 [US4] Format report output as table with totals and daily breakdown
- [ ] T087 [US4] Add internal API endpoint GET /internal/usage/report for programmatic access
- [ ] T088 [US4] Handle empty usage data gracefully with informative message

### Verification

- [ ] T089 [US4] Write unit tests for UsageTracker.getUsageReport() with various filters
- [ ] T090 [US4] Write test for date range filtering
- [ ] T091 [US4] Write test for key ID filtering
- [ ] T092 [US4] Write test for empty usage data response
- [ ] T093 [US4] Test report command: `npm run usage:report` - verify output format
- [ ] T094 [US4] Test filtered report: `npm run usage:report -- --key-id <uuid> --from 2026-01-01`
- [ ] T095 [US4] Test empty report: Run report with future date range, verify empty message

---

## Phase 7: Polish & Cross-Cutting Concerns

**Goal**: Ensure code quality, documentation, and final integration.

### Tasks

- [ ] T096 Run full test suite and ensure all tests pass: `npm test`
- [ ] T097 Run linting and fix any issues: `npm run lint`
- [ ] T098 Run type checking: `npm run build` or `tsc --noEmit`
- [ ] T099 [P] Add JSDoc comments to public methods in ApiKeyManager
- [ ] T100 [P] Add JSDoc comments to public methods in UsageTracker
- [ ] T101 Verify all error messages are actionable and user-friendly
- [ ] T102 Verify API key never appears in logs (security check)
- [ ] T103 Update CLAUDE.md with new feature documentation if needed
- [ ] T104 Create sample api-keys.json file for documentation/testing
- [ ] T105 Create sample usage-data.json file for documentation/testing

### Verification

- [ ] T106 Verify test coverage meets 80% minimum: `npm run test:coverage` (if available)
- [ ] T107 Run final integration test: Create key, make requests, check usage report, disable/delete key
- [ ] T108 Verify all npm scripts work: key:create, key:list, key:disable, key:enable, key:delete, usage:report
- [ ] T109 Security review: Verify no plaintext keys in storage or logs
- [ ] T110 Performance check: Verify auth middleware adds <5ms latency

---

## Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
Phase 3 (US1: API Key Validation) ──────────────────┐
    ↓                                                │
Phase 4 (US2: CLI Key Management)                   │
    ↓                                                │
Phase 5 (US3: Usage Tracking) ──────────────────────┤
    ↓                                                │
Phase 6 (US4: Usage Report Query)                   │
    ↓                                                │
Phase 7 (Polish) ← uses all components ─────────────┘
```

**User Story Dependencies**:
- US1 (API Key Validation) is foundational - no dependencies
- US2 (CLI Key Management) depends on US1 (needs ApiKeyManager from US1)
- US3 (Usage Tracking) depends on US1 (needs to track authenticated requests)
- US4 (Usage Report Query) depends on US3 (needs tracked usage data)
- US2 and US3 can be developed in parallel after US1

---

## Parallel Execution Opportunities

### Phase 2 (Foundational)
Tasks T009-T013 (type definitions) can be executed in parallel.

### Phase 3 (US1)
After T021 (ApiKeyManager class creation):
- T023-T027 (CRUD methods) can be developed in parallel by different developers
- T029-T030 (auth middleware) can start after T024 (validateKey)

### Phase 7 (Polish)
Tasks T099-T100 (JSDoc comments) can be done in parallel.

---

## Implementation Strategy

**MVP Scope**: Phase 1-3 (Setup + Foundational + US1)
- Provides immediate security value
- Enables authenticated access to the gateway
- Can be deployed independently

**Incremental Delivery**:
1. **Milestone 1** (Phases 1-3): Secure gateway with key validation
2. **Milestone 2** (Phase 4): Self-service key management via CLI
3. **Milestone 3** (Phase 5): Usage tracking for monitoring
4. **Milestone 4** (Phase 6): Usage reporting for analysis
5. **Milestone 5** (Phase 7): Production-ready with documentation

---

## Summary

| Phase | Description | Task Count |
|-------|-------------|------------|
| Phase 1 | Setup | 8 tasks |
| Phase 2 | Foundational | 12 tasks |
| Phase 3 | US1: API Key Validation | 22 tasks |
| Phase 4 | US2: CLI Key Management | 17 tasks |
| Phase 5 | US3: Usage Tracking | 21 tasks |
| Phase 6 | US4: Usage Report Query | 15 tasks |
| Phase 7 | Polish | 15 tasks |
| **Total** | | **110 tasks** |

**Parallel Opportunities**: 15+ tasks marked with [P]

**Verification Tasks**: 25 verification tasks (after each phase)

**MVP Scope**: Phases 1-3 (42 tasks)
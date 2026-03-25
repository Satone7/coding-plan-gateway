# Tasks: CPG CLI Executable

**Input**: Design documents from `specs/006-cpg-cli/`
**Prerequisites**: design.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit and integration tests are included per project standards (Vitest, 80% coverage minimum).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths follow existing project structure from design.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and CLI infrastructure

- [x] T001 Create bin/ directory and executable entry script in bin/cpg
- [x] T002 Add CLI types to src/types/cli.ts (CliContext, ParsedArgs, OutputFormatter, TestKeyResult, CliError)
- [x] T003 [P] Update package.json with bin field pointing to bin/cpg
- [x] T004 [P] Add CLI-related environment variables to src/config/defaults.ts (GATEWAY_URL default)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create output formatter interface and table formatter in src/cli/output/table.ts
- [x] T006 [P] Create JSON output formatter in src/cli/output/json.ts
- [x] T007 Create CLI context factory in src/cli/context.ts
- [x] T008 Refactor src/cli/api-key-cli.ts to use new output formatters
- [x] T009 Create main CLI entry point with command routing in src/cli/index.ts
- [x] T010 [P] Add unit tests for table formatter in tests/unit/cli/output/table.test.ts
- [x] T011 [P] Add unit tests for JSON formatter in tests/unit/cli/output/json.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Execute CLI Commands via `cpg` Executable (Priority: P1) 🎯 MVP

**Goal**: Provide a standalone `cpg` executable with all key management commands

**Independent Test**: Build executable, run `cpg --help`, `cpg key create --name "test"`, `cpg key list`

### Tests for User Story 1

- [x] T012 [P] [US1] Add unit tests for key create command in tests/unit/cli/commands/key-create.test.ts
- [x] T013 [P] [US1] Add unit tests for key list command in tests/unit/cli/commands/key-list.test.ts
- [x] T014 [P] [US1] Add unit tests for key test command in tests/unit/cli/commands/key-test.test.ts
- [x] T015 [P] [US1] Add unit tests for key disable/enable commands in tests/unit/cli/commands/key-status.test.ts
- [x] T016 [P] [US1] Add unit tests for key delete command in tests/unit/cli/commands/key-delete.test.ts

### Implementation for User Story 1

- [x] T017 [P] [US1] Implement key create command handler in src/cli/commands/key.ts
- [x] T018 [P] [US1] Implement key list command handler in src/cli/commands/key.ts
- [x] T019 [US1] Implement key test command handler in src/cli/commands/key.ts
- [x] T020 [P] [US1] Implement key disable/enable command handlers in src/cli/commands/key.ts
- [x] T021 [P] [US1] Implement key delete command handler in src/cli/commands/key.ts
- [x] T022 [US1] Add --json flag support to all key commands
- [x] T023 [US1] Add --version and --help flags to CLI entry point
- [x] T024 [US1] Add integration test for CLI commands in tests/integration/cli/cli-integration.test.ts

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Docker Container CLI Support (Priority: P2)

**Goal**: Enable CLI commands inside running Docker containers via `docker exec`

**Independent Test**: Start gateway container, run `docker exec gateway cpg key create --name "Docker Key"`, verify key is created

### Tests for User Story 2

- [ ] T025 [P] [US2] Add E2E test for Docker CLI execution in tests/e2e/docker-cli.test.ts

### Implementation for User Story 2

- [ ] T026 [US2] Update Dockerfile to copy bin/cpg and add to PATH
- [ ] T027 [US2] Ensure bin/cpg has execute permissions in Docker image
- [ ] T028 [US2] Verify CLI works with Docker volume mounts for storage access

**Checkpoint**: At this point, CLI works inside Docker containers

---

## Phase 5: User Story 3 - Real-time Key Availability in Running Gateway (Priority: P3)

**Goal**: API keys created via CLI are immediately available for authentication without gateway restart

**Independent Test**: Start gateway, create key via CLI, immediately use key for authenticated request

### Tests for User Story 3

- [ ] T029 [P] [US3] Add unit tests for gateway notifier service in tests/unit/services/gateway-notifier.test.ts
- [ ] T030 [P] [US3] Add unit tests for reload endpoint in tests/unit/routes/internal/reload.test.ts
- [ ] T031 [US3] Add integration test for real-time key availability in tests/integration/cli/realtime-key.test.ts

### Implementation for User Story 3

- [ ] T032 [P] [US3] Create gateway notifier service in src/services/gateway-notifier.ts
- [ ] T033 [US3] Create internal reload endpoint in src/routes/internal/reload.ts
- [ ] T034 [US3] Register reload endpoint in src/routes/internal/index.ts
- [ ] T035 [US3] Integrate gateway notifier into key command handlers (create, disable, enable, delete)
- [ ] T036 [US3] Add GATEWAY_URL environment variable support to CLI context

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - E2E Testing Environment Support (Priority: P4)

**Goal**: E2E testing environment supports `cpg` CLI for test scenarios

**Independent Test**: Start E2E environment, run `docker exec gateway cpg key create`, verify key creation

### Tests for User Story 4

- [ ] T037 [P] [US4] Add E2E test script for CLI operations in tests/e2e/e2e-cli.test.ts

### Implementation for User Story 4

- [ ] T038 [US4] Update docker-compose.e2e.yml to ensure CLI availability
- [ ] T039 [US4] Update E2E start script to verify CLI functionality
- [ ] T040 [US4] Add usage-report command handler in src/cli/commands/usage.ts
- [ ] T041 [US4] Add unit tests for usage-report command in tests/unit/cli/commands/usage.test.ts

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T042 [P] Update README.md with CLI usage documentation
- [ ] T043 [P] Add CLI exit codes documentation to quickstart.md
- [ ] T044 Run quickstart.md validation scenarios
- [ ] T045 [P] Verify test coverage meets 80% minimum for new code
- [ ] T046 Run full test suite and verify all tests pass
- [ ] T047 Security review for internal API endpoint (localhost-only binding)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Independent, uses US1 CLI
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Independent, enhances US1/US2
- **User Story 4 (P4)**: Depends on US1 and US2 being complete (needs CLI and Docker support)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Command handlers before integration
- Core implementation before refinement

### Parallel Opportunities

- T003, T004 can run in parallel (different files)
- T005, T006 can run in parallel (different files)
- T010, T011 can run in parallel (different test files)
- T012-T016 can all run in parallel (different test files)
- T017, T018, T020, T021 can run in parallel (different handlers)
- T029, T030 can run in parallel (different test files)
- T032 can run in parallel with T033 (different files)

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all tests for User Story 1 together:
Task: "Add unit tests for key create command in tests/unit/cli/commands/key-create.test.ts"
Task: "Add unit tests for key list command in tests/unit/cli/commands/key-list.test.ts"
Task: "Add unit tests for key test command in tests/unit/cli/commands/key-test.test.ts"
Task: "Add unit tests for key disable/enable commands in tests/unit/cli/commands/key-status.test.ts"
Task: "Add unit tests for key delete command in tests/unit/cli/commands/key-delete.test.ts"
```

## Parallel Example: User Story 1 Implementation

```bash
# Launch all command handlers for User Story 1 together:
Task: "Implement key create command handler in src/cli/commands/key.ts"
Task: "Implement key list command handler in src/cli/commands/key.ts"
Task: "Implement key disable/enable command handlers in src/cli/commands/key.ts"
Task: "Implement key delete command handler in src/cli/commands/key.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test `cpg` commands independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test Docker CLI → Deploy/Demo
4. Add User Story 3 → Test real-time key availability → Deploy/Demo
5. Add User Story 4 → Test E2E environment → Deploy/Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (core CLI commands)
   - Developer B: User Story 2 (Docker integration)
   - Developer C: User Story 3 (gateway notification)
3. Stories complete and integrate independently
4. User Story 4 can start after US1 and US2 complete

---

## Architecture Alignment

From `docs/architecture.md`:

- **ADR-001 (Monolithic Single-Process)**: CLI shares same process space, no separate service
- **ADR-002 (File-Based Configuration)**: CLI operates on same JSON files as gateway
- **Quality Target**: CLI commands < 1 second, key availability < 100ms after creation
- **Security**: Internal API binds to localhost only, no authentication required

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
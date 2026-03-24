# Tasks: Fix Task Completion Issues

**Input**: Design documents from `specs/002-fix-task-completion-issues/`
**Prerequisites**: design.md, spec.md, research.md, data-model.md, contracts/npm-scripts.md

**Tests**: Test tasks are included as this feature specifically addresses test coverage requirements (FR-005).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Prepare scripts directory for new CLI tools

- [X] T001 Create scripts/ directory for CLI utilities

---

## Phase 1.5: Fix Build Errors (BLOCKER) 🚨

**Purpose**: Resolve TypeScript compilation errors that block all subsequent work

**Goal**: `npm run build` completes successfully with zero TypeScript errors

**Independent Test**: Run `npm run build` and verify zero compilation errors

### Implementation

- [X] T001.1 Fix type mismatch in src/index.ts:37 - `config.plans` (PlanConfig[]) vs `CodingPlan[]`
- [X] T001.2 Fix `unknown` type error in src/routes/anthropic/handlers.ts:100 - add proper type assertion for usage data
- [X] T001.3 Fix `unknown` type error in src/routes/anthropic/handlers.ts:221 - add proper return type handling
- [X] T001.4 Fix `unknown` type error in src/routes/openai/handlers.ts:102 - add proper type assertion for usage data
- [X] T001.5 Fix `unknown` type error in src/routes/openai/handlers.ts:222 - add proper return type handling

**Checkpoint**: `npm run build` exits 0 with no TypeScript errors ✅ VERIFIED

**Root Cause Analysis**: These errors were introduced during refactoring in Phase 5 (US4). The refactoring changed function signatures and removed type assertions without updating dependent code.

---

## Phase 2: User Story 1 - Quota Data Persisted on Application Exit (Priority: P1) 🎯 MVP

**Goal**: Persist quota state to file when application receives shutdown signals (SIGINT/SIGTERM)

**Independent Test**: Start gateway, make API requests to consume quota, stop with Ctrl+C, restart, verify quota state preserved

### Implementation for User Story 1

- [X] T002 [US1] Modify AppOptions interface to accept quotaManager in src/app.ts
- [X] T003 [US1] Register onClose hook for quotaManager.shutdown() in src/app.ts
- [X] T004 [US1] Create quotaManager instance in src/index.ts
- [X] T005 [US1] Initialize quotaManager with config.plans in src/index.ts
- [X] T006 [US1] Start periodic sync and pass quotaManager to createApp in src/index.ts

### Tests for User Story 1

- [ ] T007 [P] [US1] Add shutdown hook test in tests/unit/app.test.ts

**Checkpoint**: Graceful shutdown should persist quota state to quota-state.json on SIGINT/SIGTERM

---

## Phase 3: User Story 2 - NPM Scripts for Configuration Management (Priority: P2)

**Goal**: Add `npm run reload` and `npm run config:validate` scripts for configuration management

**Independent Test**: Run `npm run config:validate` with valid/invalid configs, run `npm run reload` against running server

### Implementation for User Story 2

- [X] T008 [P] [US2] Create validate-config.ts CLI script in scripts/validate-config.ts
- [X] T009 [US2] Add config:validate script entry to package.json
- [X] T010 [US2] Add reload endpoint POST /api/reload in src/routes/admin/index.ts
- [X] T011 [US2] Add reload script entry to package.json

### Tests for User Story 2

- [ ] T012 [P] [US2] Add config:validate success test in tests/unit/scripts/validate-config.test.ts
- [ ] T013 [P] [US2] Add config:validate failure test in tests/unit/scripts/validate-config.test.ts

**Checkpoint**: `npm run config:validate` exits 0 for valid config, 1 for invalid; `npm run reload` triggers hot-reload

---

## Phase 4: User Story 3 - Reliable Test Suite with Adequate Coverage (Priority: P2)

**Goal**: Achieve 80%+ test coverage for lines, functions, and statements

**Independent Test**: Run `npm run test:coverage` and verify all metrics >= 80%

### Tests for User Story 3

- [X] T014 [P] [US3] Create health route tests in tests/unit/routes/health.test.ts
- [X] T015 [P] [US3] Create validators utility tests in tests/unit/utils/validators.test.ts
- [ ] T016 [P] [US3] Add streaming error tests in tests/unit/services/request-proxy.test.ts
- [ ] T017 [P] [US3] Add error branch tests in tests/unit/services/request-router.test.ts

**Checkpoint**: `npm run test:coverage` shows >= 80% for lines, functions, statements

---

## Phase 5: User Story 4 - Clean Linting Output (Priority: P3)

**Goal**: Zero lint warnings across the codebase

**Independent Test**: Run `npm run lint` and verify zero warnings reported

### Implementation for User Story 4

- [X] T018 [P] [US4] Refactor createMessage function under 50 lines in src/routes/anthropic/handlers.ts
- [X] T019 [P] [US4] Refactor createChatCompletion function under 50 lines in src/routes/openai/handlers.ts
- [X] T020 [P] [US4] Refactor makeRequest method with options object in src/services/request-proxy.ts
- [X] T021 [P] [US4] Refactor makeStreamingRequest method with options object in src/services/request-proxy.ts
- [X] T022 [P] [US4] Refactor route method under 50 lines in src/services/request-router.ts
- [X] T023 [P] [US4] Fix max-depth warnings with early returns in src/routes/anthropic/handlers.ts
- [X] T024 [P] [US4] Fix max-depth warnings with early returns in src/routes/openai/handlers.ts
- [X] T025 [P] [US4] Remove unused imports in tests/unit/services/circuit-breaker.test.ts
- [X] T026 [P] [US4] Remove unused imports in tests/unit/services/plan-repository.test.ts
- [X] T027 [P] [US4] Remove unused imports in tests/unit/services/quota-manager.test.ts
- [X] T028 [P] [US4] Remove unused imports in tests/unit/services/request-proxy.test.ts
- [X] T029 [P] [US4] Remove unused variables in tests/unit/services/request-router.test.ts

**Checkpoint**: `npm run lint` reports 0 warnings, 0 errors

---

## Phase 6: Polish & Verification

**Purpose**: Final verification and documentation updates

- [ ] T030 Run full test suite and verify all tests pass
- [ ] T031 Run lint and verify zero warnings
- [ ] T032 Run coverage and verify >= 80% threshold met
- [ ] T033 Verify graceful shutdown with manual test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Fix Build Errors (Phase 1.5)**: 🚨 **BLOCKER** - Must complete before Phase 2-6
- **User Story 1 (Phase 2)**: Depends on Phase 1.5
- **User Story 2 (Phase 3)**: Depends on Phase 1.5 - can run parallel to US1
- **User Story 3 (Phase 4)**: Depends on Phase 1.5 - can run parallel to US1/US2
- **User Story 4 (Phase 5)**: Depends on Phase 1.5 - can run parallel to US1/US2/US3
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: No dependencies on other stories
- **User Story 2 (P2)**: No dependencies on other stories
- **User Story 3 (P2)**: No dependencies on other stories
- **User Story 4 (P3)**: No dependencies on other stories

### Parallel Opportunities

All user stories can be implemented in parallel as they modify different files:
- US1: src/app.ts, src/index.ts
- US2: scripts/validate-config.ts, package.json, src/routes/admin/index.ts
- US3: tests/unit/routes/health.test.ts, tests/unit/utils/validators.test.ts, etc.
- US4: Various source and test files (refactoring)

---

## Parallel Example: Multiple User Stories

```bash
# These can all run in parallel by different developers:
Task: "T002-T007 [US1] Graceful shutdown implementation"
Task: "T008-T013 [US2] NPM scripts implementation"
Task: "T014-T017 [US3] Test coverage improvements"
Task: "T018-T029 [US4] Lint warning fixes"
```

---

## Implementation Strategy

### 🔴 CRITICAL: Fix Build First (Phase 1.5)

1. **MUST complete Phase 1.5 before any other work**
2. Run `npm run build` to verify fix
3. Only proceed to US1-US4 after build succeeds

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. ~~Complete Phase 2: User Story 1 (T002-T007)~~
3. Complete Phase 1.5: Fix Build Errors (T001.1-T001.5)
4. Complete Phase 2: User Story 1 (T002-T007)
5. **STOP and VALIDATE**: Test graceful shutdown manually
6. Quota state persistence is now reliable

### Incremental Delivery

0. Fix Build Errors (Phase 1.5) → Project can be built ✓
1. Complete US1 → Data integrity on shutdown ✓
2. Add US2 → Developer convenience scripts ✓
3. Add US3 → Code quality with 80%+ coverage ✓
4. Add US4 → Clean lint output ✓
5. Run Polish phase → All success criteria verified ✓

### Risk Mitigation

- **Build Errors (Phase 1.5)**: Run `npm run build` after ANY code change to catch regressions early
- Per research.md risk assessment:
- Run full test suite after each refactoring task (US4)
- Focus tests on uncovered lines identified in coverage report (US3)
- Test shutdown with SIGINT, SIGTERM, and normal close (US1)

---

## Notes

- [P] tasks = different files, no dependencies between tasks
- [Story] label maps task to specific user story for traceability
- All 4 user stories are independent and can be done in parallel
- Commit after each task or logical group
- Run tests frequently during US4 refactoring to catch regressions
- Coverage improvements (US3) can be done incrementally during other work
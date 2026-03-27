# Tasks: Request Latency Tracing

**Input**: Design documents from `specs/012-request-latency-tracing/`
**Prerequisites**: design.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Tests included as per ground-rules requirement for new features.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- This feature follows existing project structure

---

## Phase 1: Setup

**Purpose**: Type definitions and constants (minimal setup - project already initialized)

- [X] T001 [P] Create StageName type and StageTiming interface in `src/types/request-trace.ts`
- [X] T002 [P] Create RequestTrace interface in `src/types/request-trace.ts`
- [X] T003 [P] Create TimingSummary interface and ANSI_COLOR_CODES constant in `src/types/request-trace.ts`
- [X] T004 Export types from `src/types/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core tracer module that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Create RequestTimer class with startStage/endStage/getTrace methods in `src/middleware/request-timer.ts`
- [X] T006 Implement createRequestTrace factory function with color assignment in `src/middleware/request-timer.ts`
- [X] T007 Implement logSummary method that outputs JSON per timing-schema.json in `src/middleware/request-timer.ts`
- [X] T008 Register onRequest hook to initialize trace and start 'requestReceived' stage in `src/middleware/request-timer.ts`
- [X] T009 Register onResponse hook to end 'responseSent' stage and log summary in `src/middleware/request-timer.ts`
- [X] T010 Create registerRequestTimer function to attach hooks to Fastify app in `src/middleware/request-timer.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - 查看请求各阶段耗时 (Priority: P1) 🎯 MVP

**Goal**: Developers can see timing for each processing stage (validation, routing, quotaCheck, apiKeyDecryption, upstreamRequest) in logs

**Independent Test**: Send HTTP request to Gateway, verify JSON log output contains all stage timings with durationMs values

### Tests for User Story 1

- [X] T011 [P] [US1] Unit test for RequestTimer.startStage/endStage in `tests/unit/middleware/request-timer.test.ts`
- [X] T012 [P] [US1] Unit test for RequestTimer.logSummary JSON format in `tests/unit/middleware/request-timer.test.ts`
- [X] T013 [US1] Integration test for stage timing on /v1/chat/completions in `tests/integration/request-tracing.test.ts`

### Implementation for User Story 1

- [X] T014 [US1] Add timing markers around validation in `src/routes/openai/handlers.ts` and `src/routes/anthropic/handlers.ts`
- [X] T015 [US1] Add timing markers around routing in `src/services/request-router.ts`
- [X] T016 [US1] Add timing markers around quotaCheck in handlers
- [X] T017 [US1] Add timing markers around apiKeyDecryption in `src/services/plan-repository.ts` or handlers
- [X] T018 [US1] Add timing markers around upstreamRequest in `src/services/request-proxy.ts` or handlers
- [X] T019 [US1] Integrate registerRequestTimer in `src/app.ts` for external API routes only (per FR-011)

**Checkpoint**: User Story 1 complete - all stage timings visible in logs

---

## Phase 4: User Story 2 - 区分并发请求 (Priority: P2)

**Goal**: Developers can distinguish concurrent requests via requestId in logs

**Independent Test**: Send two concurrent requests, verify each has different requestId and can be filtered

### Tests for User Story 2

- [X] T020 [P] [US2] Unit test verifying requestId is included in TimingSummary in `tests/unit/middleware/request-timer.test.ts`
- [X] T021 [US2] Integration test for concurrent request requestId uniqueness in `tests/integration/request-tracing.test.ts`

### Implementation for User Story 2

- [X] T022 [US2] Ensure requestId is captured from Fastify request.id in trace initialization
- [X] T023 [US2] Verify requestId appears in all log lines for a request (existing logger integration)

**Checkpoint**: User Stories 1 AND 2 complete - concurrent requests distinguishable by requestId

---

## Phase 5: User Story 3 - 可视化区分请求 (Priority: P3)

**Goal**: Different requests have different ANSI colors in terminal output for visual distinction

**Independent Test**: Send three concurrent requests, verify each has different colorIndex (0-9) and terminal shows different colors

### Tests for User Story 3

- [X] T024 [P] [US3] Unit test for color assignment modulo logic in `tests/unit/middleware/request-timer.test.ts`
- [X] T025 [US3] Unit test for ANSI color code prefix in log output in `tests/unit/middleware/request-timer.test.ts`

### Implementation for User Story 3

- [X] T026 [US3] Implement request counter with modulo COLOR_PALETTE_SIZE in `src/middleware/request-timer.ts`
- [X] T027 [US3] Add ANSI color prefix to log output in logger integration
- [X] T028 [US3] Ensure colorIndex (0-9) is included in TimingSummary JSON output

**Checkpoint**: All user stories complete - visual differentiation working

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Quality improvements and documentation

- [X] T029 [P] Add TSDoc comments to RequestTimer public methods in `src/middleware/request-timer.ts`
- [X] T030 [P] Add TSDoc comments to types in `src/types/request-trace.ts`
- [X] T031 Verify timing overhead is <1ms with performance test
- [X] T032 Run quickstart.md validation - verify all log examples work
- [X] T033 Update CLAUDE.md Active Technologies section if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
- **Polish (Phase 6)**: Depends on all user stories complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational - Builds on US1 infrastructure but independently testable
- **User Story 3 (P3)**: Can start after Foundational - Builds on US1/US2 infrastructure but independently testable

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types/interfaces before implementation
- Core timing before stage markers
- Handlers integration last

### Parallel Opportunities

**Phase 1 (all parallel)**:
```bash
T001, T002, T003 can run in parallel (different interfaces in same file but independent)
```

**Phase 3 tests (parallel)**:
```bash
T011, T012 can run in parallel (different test cases)
```

---

## Parallel Example: User Story 1

```bash
# Launch tests for User Story 1 together:
Task: T011 "Unit test for RequestTimer.startStage/endStage"
Task: T012 "Unit test for RequestTimer.logSummary JSON format"

# After tests fail, implement:
Task: T014-T018 "Add timing markers" (sequential due to file dependencies)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types)
2. Complete Phase 2: Foundational (tracer module)
3. Complete Phase 3: User Story 1 (stage timing)
4. **STOP and VALIDATE**: Verify timing logs appear for all stages
5. Deploy/demo - core value delivered

### Incremental Delivery

1. Setup + Foundational → Types and tracer ready
2. Add User Story 1 → Stage timing visible → **MVP!**
3. Add User Story 2 → requestId tracking
4. Add User Story 3 → Visual color differentiation
5. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files or independent test cases
- [Story] label maps task to specific user story
- Tests verify behavior before implementation (ground-rules compliance)
- Streaming requests: timing logged at stream start, total logged at completion
- Failover requests: additional upstream timing for each attempt
- Internal endpoints (/health, /internal/*) excluded per FR-011
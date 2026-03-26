# Tasks: Fix Usage Tracking Issues

**Input**: Design documents from `specs/011-fix-usage-tracking/`
**Prerequisites**: design.md, spec.md, research.md, data-model.md, contracts/usage-api.yaml, quickstart.md

**Tests**: Tests are included as this is a bug fix requiring verification of correct behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- Paths follow existing project structure per design.md

---

## Phase 1: Setup

**Purpose**: Add new dependencies and project configuration

- [x] T001 Install proper-lockfile dependency for file locking with `npm install proper-lockfile`
- [x] T002 [P] Add TypeScript type declarations for proper-lockfile with `npm install -D @types/proper-lockfile`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core changes that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extend PlanInfo interface to include expiresOn and expiresAt in `src/types/plan-usage.ts`
- [x] T004 Add file locking to PlanUsageTracker.persist() method in `src/services/plan-usage-tracker.ts`
- [x] T005 Add file locking to PlanUsageTracker.load() method in `src/services/plan-usage-tracker.ts`
- [x] T006 Implement calculateResetDate() method in PlanUsageTracker using calculateEffectiveExpiration in `src/services/plan-usage-tracker.ts`
- [x] T007 Add getUsageForQuotaManager() method to PlanUsageTracker for single source of truth in `src/services/plan-usage-tracker.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Correct Quota Reset Date Display (Priority: P1) 🎯 MVP

**Goal**: Usage reports display the correct quota reset date based on the plan's expiresOn configuration.

**Independent Test**: Configure a plan with expiresOn: 27, run `cpg usage-report --plan <id>`, and verify the reset date shows the 27th of the month.

### Tests for User Story 1

- [x] T008 [P] [US1] Add unit tests for calculateResetDate with expiresOn in `tests/unit/services/plan-usage-tracker.test.ts`
- [x] T009 [P] [US1] Add unit tests for month boundary edge cases (e.g., Feb 31) in `tests/unit/services/plan-usage-tracker.test.ts`

### Implementation for User Story 1

- [x] T010 [US1] Modify CLI usage report command to pass expiresOn to report generation in `src/cli/commands/usage.ts`
- [x] T011 [US1] Modify generateUsageReport to use calculateResetDate for resetAt field in `src/services/plan-usage-tracker.ts`
- [x] T012 [US1] Modify GET /api/admin/plans/:planId/usage endpoint to include expiresOn in response in `src/routes/admin/handlers.ts`
- [x] T013 [US1] Add integration test for usage report with expiresOn in `tests/integration/usage-report-expireson.test.ts`

**Checkpoint**: User Story 1 complete - usage reports now show correct reset dates

---

## Phase 4: User Story 2 - Consistent Usage Values Across Systems (Priority: P1)

**Goal**: Manual usage adjustments via set-usage are reflected in both usage reports AND quota routing decisions.

**Independent Test**: Set usage via CLI, make a request through the gateway, and verify both the usage report and routing behavior reflect the adjusted value.

### Tests for User Story 2

- [x] T014 [P] [US2] Add unit tests for QuotaManager.setUsedQuota() method in `tests/unit/services/quota-manager.test.ts`
- [x] T015 [P] [US2] Add unit tests for quota sync endpoint handler in `tests/unit/routes/admin/handlers.test.ts`

### Implementation for User Story 2

- [x] T016 [US2] Add setUsedQuota(planId, value) method to QuotaManager in `src/services/quota-manager.ts`
- [x] T017 [US2] Create POST /api/admin/quota/:planId/sync endpoint in `src/routes/admin/handlers.ts`
- [x] T018 [US2] Modify set-usage CLI command to call sync endpoint when server is running in `src/cli/commands/plan.ts`
- [x] T019 [US2] Add server running detection to set-usage command in `src/cli/commands/plan.ts`
- [x] T020 [US2] Add integration test for set-usage sync with running server in `tests/integration/cli/plan-usage-sync.test.ts`

**Checkpoint**: User Story 2 complete - set-usage now syncs with QuotaManager

---

## Phase 5: User Story 3 - Unified Usage Data Source (Priority: P2)

**Goal**: Single authoritative source for usage data, eliminating discrepancies between different parts of the system.

**Independent Test**: Verify that all usage queries (reports, routing, CLI commands) read from and write to the same underlying data store.

### Tests for User Story 3

- [x] T021 [P] [US3] Add unit tests for QuotaManager querying PlanUsageTracker in `tests/unit/services/quota-manager.test.ts`
- [x] T022 [P] [US3] Add regression tests ensuring all usage sources return same value in `tests/unit/services/usage-consistency.test.ts`

### Implementation for User Story 3

- [x] T023 [US3] Modify QuotaManager.getUsedQuota() to query PlanUsageTracker.getUsageForQuotaManager() in `src/services/quota-manager.ts`
- [x] T024 [US3] Update QuotaManager.incrementUsage() to also update PlanUsageTracker in `src/services/quota-manager.ts`
- [ ] T025 [US3] Add automatic usage reset on expiresOn date at midnight in `src/services/plan-usage-tracker.ts`
- [ ] T026 [US3] Add scheduler for expiration reset check in `src/server.ts` or dedicated scheduler module
- [ ] T027 [US3] Add integration test for unified usage across CLI and API in `tests/integration/usage-unified-source.test.ts`

**Checkpoint**: User Story 3 complete - single source of truth for usage data

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T028 [P] Update CLAUDE.md with feature 011 in Active Technologies section
- [x] T029 [P] Add warning when set-usage exceeds quota limit in `src/cli/commands/plan.ts`
- [x] T030 [P] Add logging for usage adjustments and syncs in `src/services/plan-usage-tracker.ts`
- [x] T031 Run all existing tests to ensure no regressions with `npm test`
- [x] T032 Run quickstart.md validation scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 (P1) and US2 (P1) can proceed in parallel
  - US3 (P2) depends on US2 completion (requires set-usage sync infrastructure)
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - Independent
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Independent
- **User Story 3 (P2)**: Depends on US2 completion (uses sync infrastructure)

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001 and T002 can run in parallel (different files/operations)
- All test tasks marked [P] can run in parallel
- US1 and US2 can be worked on in parallel after Foundational phase
- T028, T029, T030 can run in parallel in Polish phase

---

## Parallel Example: Foundational Phase

```bash
# After T001-T002 complete, these can run in parallel:
Task: "T004 Add file locking to PlanUsageTracker.persist() method in src/services/plan-usage-tracker.ts"
Task: "T005 Add file locking to PlanUsageTracker.load() method in src/services/plan-usage-tracker.ts"
# (same file, so must be sequential in practice, but with proper coordination can overlap)
```

## Parallel Example: User Story 1 Tests

```bash
# Launch tests in parallel:
Task: "T008 [P] [US1] Add unit tests for calculateResetDate with expiresOn in tests/unit/services/plan-usage-tracker.test.ts"
Task: "T009 [P] [US1] Add unit tests for month boundary edge cases in tests/unit/services/plan-usage-tracker.test.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 - expiresOn display fix
4. Complete Phase 4: User Story 2 - set-usage sync
5. **STOP and VALIDATE**: Test both user stories independently
6. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy (Fixes Issue 001)
3. Add User Story 2 → Test independently → Deploy (Fixes Issue 002)
4. Add User Story 3 → Test independently → Deploy (Unification)
5. Each story adds value without breaking previous stories

---

## Architecture Alignment

| ADR | Alignment |
|-----|-----------|
| ADR-001 | ✅ Single-process architecture preserved |
| ADR-002 | ✅ File-based storage continued with file locking |
| ADR-003 | ✅ In-memory tracking unified under PlanUsageTracker |
| ADR-004 | ✅ No changes to API format support |
| ADR-005 | ✅ Quota-based load balancing unchanged |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests written first (TDD approach for bug fixes)
- File locking prevents concurrent write conflicts between CLI and server
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
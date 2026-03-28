# Tasks: Model Alias Configuration

**Input**: Design documents from `specs/014-model-alias-config/`
**Prerequisites**: design.md (required), spec.md (required for user stories), data-model.md

**Tests**: Tests are NOT required for this feature (not specified in spec)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project already initialized - no setup needed for this feature

*This is a modification-only feature - existing project structure is sufficient.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core schema changes that MUST be complete before user story implementation

- [ ] T001 Add modelAliasesSchema to src/config/schema.ts
- [ ] T002 [P] Update Config type to include modelAliases in src/config/schema.ts

---

## Phase 3: User Story 1 - Configure Model Aliases via Config File (Priority: P1) 🎯 MVP

**Goal**: Enable model aliases to be configured via config.yaml instead of hardcoded constants

**Independent Test**: Update config.yaml with new aliases and verify gateway correctly resolves those aliases

### Implementation for User Story 1

- [ ] T003 [P] [US1] Modify ModelResolver to accept aliases as constructor parameter in src/services/model-resolver.ts
- [ ] T004 [P] [US1] Remove hardcoded MODEL_ALIASES constant from src/services/model-resolver.ts
- [ ] T005 [US1] Add circular alias detection method to ModelResolver in src/services/model-resolver.ts (depends on T003, T004)
- [ ] T006 [US1] Update config loader to pass modelAliases to ModelResolver in src/config/index.ts
- [ ] T007 [US1] Add example modelAliases to config.yaml with common aliases

**Checkpoint**: At this point, User Story 1 should be fully functional - aliases can be configured via config.yaml

---

## Phase 4: User Story 2 - Hot-Reload Model Aliases (Priority: P2)

**Goal**: Alias configuration changes take effect on hot-reload without restart

**Independent Test**: Add new aliases to config.yaml, trigger reload, verify new aliases work immediately

### Implementation for User Story 2

- [ ] T008 [P] [US2] Add method to update aliases at runtime in src/services/model-resolver.ts
- [ ] T009 [US2] Ensure hot-reload mechanism passes new modelAliases to ModelResolver in src/config/index.ts
- [ ] T010 [US2] Test hot-reload with alias changes

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - List Available Model Aliases (Priority: P3)

**Note**: This user story is marked as OUT OF SCOPE in design.md - "Optional future enhancement". Skipping implementation.

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T011 [P] Update existing model-resolver tests to reflect new config-based behavior in tests/unit/services/model-resolver.test.ts
- [ ] T012 Run quickstart.md validation
- [ ] T013 [P] Run lint and type-check

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: N/A - project already initialized
- **Foundational (Phase 2)**: Must complete before User Story 1
- **User Stories (Phase 3+)**: All depend on Foundational phase completion

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 completion - builds on alias configuration mechanism
- **User Story 3 (P3)**: OUT OF SCOPE - skipped

### Within Each User Story

- Schema changes before service changes
- Core implementation before testing
- Story complete before moving to next priority

### Parallel Opportunities

- T003 and T004 can run in parallel (different methods in same file)
- T002 is independent of T001 (but T001 should come first)
- T008 is independent of T007 (different files)

---

## Parallel Example: User Story 1

```bash
# Launch T003 and T004 in parallel (modify ModelResolver):
Task: "Modify ModelResolver to accept aliases as constructor parameter in src/services/model-resolver.ts"
Task: "Remove hardcoded MODEL_ALIASES constant from src/services/model-resolver.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational
2. Complete Phase 3: User Story 1
3. **STOP and VALIDATE**: Test alias configuration works
4. Deploy/demo if ready

### Incremental Delivery

1. Complete Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently

## Architecture Alignment

- **Config Schema**: Aligns with ADR-002 (File-Based Configuration Storage)
- **Hot Reload**: Uses existing reload mechanism from architecture
- **Validation**: Uses Zod (existing dependency) per standards
- **Testing**: Uses Vitest (existing project framework)
# Tasks: Model Name Case-Insensitive Matching

**Input**: Design documents from `specs/013-model-name-normalization/`
**Prerequisites**: design.md, spec.md

**Tests**: Unit tests included for ModelResolver

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Review existing codebase structure and understand current implementation

- [ ] T001 Review existing PlanSelector implementation in src/services/plan-selector.ts
- [ ] T002 Review existing PlanRepository implementation in src/services/plan-repository.ts
- [ ] T003 Review existing RequestRouter implementation in src/services/request-router.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core ModelResolver service that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until ModelResolver is complete

- [ ] T004 [P] Create ModelResolutionResult interface in src/services/model-resolver.ts
- [ ] T005 [P] Define MODEL_ALIASES constant with common model aliases in src/services/model-resolver.ts
- [ ] T006 Implement ModelResolver.resolve() method for alias resolution in src/services/model-resolver.ts
- [ ] T007 Implement ModelResolver.resolveWithOriginal() method in src/services/model-resolver.ts

**Checkpoint**: ModelResolver ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Case-Insensitive Model Routing (Priority: P1) 🎯 MVP

**Goal**: Enable case-insensitive model matching when routing requests to coding plans

**Independent Test**: Send requests with various model name casings (lowercase, uppercase, mixed) and verify they route to correct plan

### Tests for User Story 1

- [ ] T008 [P] [US1] Write unit tests for ModelResolver.resolve() in tests/unit/model-resolver.test.ts
- [ ] T009 [P] [US1] Write unit tests for ModelResolver.resolveWithOriginal() in tests/unit/model-resolver.test.ts
- [ ] T010 [US1] Run unit tests to verify they pass

### Implementation for User Story 1

- [ ] T011 [P] [US1] Update PlanSelector.findPlansByModel() to use ModelResolver in src/services/plan-selector.ts
- [ ] T012 Verify case-insensitive matching works with existing plan configurations

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Mixed Case Model Names (Priority: P2)

**Goal**: Ensure comprehensive case-insensitive matching covers all variations

**Independent Test**: Send requests with various case combinations (GPT-4-Turbo, gpt-4-turbo, Gpt-4-Turbo) and verify routing works

### Tests for User Story 2

- [ ] T013 [P] [US2] Add integration test for various case variations in tests/integration/model-routing.test.ts

### Implementation for User Story 2

- [ ] T014 [US2] Update RequestRouter.getPlanForRequest() to use ModelResolver in src/services/request-router.ts
- [ ] T015 [US2] Ensure original model name is preserved for upstream requests

**Checkpoint**: User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - No Match Returns Clear Error (Priority: P3)

**Goal**: Provide helpful error messages when requested model is not found

**Independent Test**: Request a non-existent model and verify error message lists available models

### Implementation for User Story 3

- [ ] T016 [P] [US3] Enhance error handling in RequestRouter to include available models in src/services/request-router.ts
- [ ] T017 [US3] Format error message with case-normalized available models list

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T018 [P] Run full test suite to verify backward compatibility
- [ ] T019 Update documentation in docs/standards.md if needed
- [ ] T020 Run quickstart.md validation scenarios from specs/013-model-name-normalization/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion

### User Story Dependencies

- **User Story 1 (P1)**: Depends on ModelResolver (Phase 2) - Core functionality
- **User Story 2 (P2)**: Depends on ModelResolver (Phase 2) - Extends routing
- **User Story 3 (P3)**: Depends on PlanSelector/Router updates from US1 - Error enhancement

### Within Each User Story

- Tests written first, verify they fail before implementation
- Models (interface) before services
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T004, T005 can run in parallel (different parts of ModelResolver)
- T008, T009 can run in parallel (different test files for ModelResolver)
- T011, T012 can run in parallel (different verification steps)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Write unit tests for ModelResolver.resolve() in tests/unit/model-resolver.test.ts"
Task: "Write unit tests for ModelResolver.resolveWithOriginal() in tests/unit/model-resolver.test.ts"

# Launch implementation tasks:
Task: "Update PlanSelector.findPlansByModel() to use ModelResolver in src/services/plan-selector.ts"
Task: "Verify case-insensitive matching works with existing plan configurations"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (ModelResolver)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Existing case-insensitive matching in PlanRepository/PlanSelector should continue to work
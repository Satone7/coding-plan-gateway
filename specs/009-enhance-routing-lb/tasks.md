# Tasks: Enhance Gateway Routing and Load Balancing

**Input**: Design documents from `specs/009-enhance-routing-lb/`
**Prerequisites**: design.md (required), spec.md (required), research.md, data-model.md, contracts/config-schema.json

**Tests**: Tests are NOT included as they were not explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create new type file structure for load balancing enhancements

- [x] T001 Create load balancing types file at `src/types/load-balancing.ts` with LoadBalanceStrategy, FactorWeights, LoadBalanceConfig interfaces
- [x] T002 Create RPM tracker types file at `src/types/rpm-tracker.ts` with RpmBucket and RpmTrackerState interfaces

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend existing types that multiple user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extend CodingPlan interface in `src/types/coding-plan.ts` to add optional fields: expiresOn (number 1-31), expiresAt (string ISO 8601), weight (number 1-100, default 1)
- [x] T004 [P] Extend plan configuration schema in `src/config/schema.ts` to validate expiresOn, expiresAt, and weight fields per contracts/config-schema.json
- [x] T005 [P] Add loadBalancing configuration section to schema in `src/config/schema.ts` with strategy and factorWeights validation

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Preserve Custom Parameters (Priority: P1) 🎯 MVP

**Goal**: Fix Zod validation dropping unknown fields in OpenAI endpoint so all custom parameters pass through to upstream providers

**Independent Test**: Send a request with custom parameters (e.g., `logprobs`, `top_logprobs`) through `/v1/chat/completions` and verify they reach the upstream provider

### Implementation for User Story 1

- [x] T006 [US1] Add `.passthrough()` method to chatCompletionSchema in `src/routes/openai/handlers.ts` to preserve unknown fields

**Checkpoint**: OpenAI endpoint now preserves all request fields

---

## Phase 4: User Story 2 - Consistent Validation Behavior (Priority: P1)

**Goal**: Ensure both OpenAI and Anthropic endpoints behave identically regarding unknown field handling

**Independent Test**: Send identical requests with unknown fields to both endpoints and verify both preserve fields identically

### Implementation for User Story 2

- [x] T007 [US2] Verify `.passthrough()` is applied to messagesSchema in `src/routes/anthropic/handlers.ts` (add if missing)
- [x] T008 [US2] Add documentation comment in both handler files explaining the transparent proxy behavior and passthrough design decision

**Checkpoint**: Both endpoints now have consistent passthrough behavior

---

## Phase 5: User Story 3 - Fair Distribution of Requests (Priority: P2)

**Goal**: Implement multiple load balancing strategies so requests are distributed fairly across plans instead of always selecting highest quota

**Independent Test**: Configure multiple plans with equal quota and verify requests are distributed fairly using round-robin strategy

### Implementation for User Story 3

- [x] T009 [P] [US3] Implement expiration score calculation utility in `src/utils/expiration.ts` with calculateExpirationScore function per research.md R4 tiered scoring
- [x] T010 [P] [US3] Implement strategy selector function in `src/services/plan-selector.ts` to select strategy implementation based on LoadBalanceConfig
- [x] T011 [P] [US3] Implement round-robin strategy in `src/services/plan-selector.ts` with plan cycling per model
- [x] T012 [P] [US3] Implement weighted-round-robin strategy in `src/services/plan-selector.ts` with proportional distribution based on plan weight
- [x] T013 [P] [US3] Implement random strategy in `src/services/plan-selector.ts` with uniform random selection
- [x] T014 [US3] Refactor selectBestPlan function in `src/services/plan-selector.ts` to use strategy pattern, maintaining backward compatibility with quota-priority as default
- [x] T015 [US3] Update request-router in `src/services/request-router.ts` to pass loadBalancing config to plan-selector

**Checkpoint**: All load balancing strategies implemented and selectable via configuration

---

## Phase 6: User Story 4 - Prioritize Expiring Plans (Priority: P2)

**Goal**: Score plans based on expiration time so plans expiring soon are prioritized to maximize quota utilization before expiration

**Independent Test**: Configure Plan A expiring in 2 hours with 50% quota and Plan B with no expiration and 80% quota, verify Plan A is selected first

### Implementation for User Story 4

- [ ] T016 [US4] Implement calculateEffectiveExpiration function in `src/utils/expiration.ts` to compute expiration from expiresOn or expiresAt with month boundary handling
- [ ] T017 [US4] Extend plan-selector in `src/services/plan-selector.ts` to calculate expiration score using calculateExpirationScore utility
- [ ] T018 [US4] Implement multi-factor scoring in `src/services/plan-selector.ts` combining expiration (40%), RPM (40%), quota (20%) scores with configurable weights
- [ ] T019 [US4] Integrate multi-factor scoring into quota-priority strategy as the default selection method

**Checkpoint**: Plans expiring soon receive higher selection priority

---

## Phase 7: User Story 5 - Balance Load Based on Current Request Rate (Priority: P3)

**Goal**: Track RPM per plan and use it in selection scoring so no single plan becomes overloaded

**Independent Test**: Send rapid requests and verify plans with lower current RPM are preferred when other factors are equal

### Implementation for User Story 5

- [ ] T020 [US5] Implement RpmTracker service in `src/services/rpm-tracker.ts` with 6-bucket sliding window (10-second granularity) per research.md R3
- [ ] T021 [US5] Implement recordRequest method in RpmTracker to update current bucket count
- [ ] T022 [US5] Implement getRpm method in RpmTracker to sum all non-expired buckets
- [ ] T023 [US5] Integrate RpmTracker with request-router in `src/services/request-router.ts` to record requests per plan
- [ ] T024 [US5] Implement RPM score calculation in `src/services/plan-selector.ts` (inverse scoring: lower RPM = higher score)
- [ ] T025 [US5] Complete multi-factor scoring integration in plan-selector with all three factors: expiration, RPM, and quota

**Checkpoint**: Full multi-factor load balancing operational with RPM awareness

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration and validation

- [ ] T026 [P] Run quickstart.md validation scenarios to verify all features work end-to-end
- [ ] T027 [P] Update any affected inline documentation in modified files
- [ ] T028 Verify backward compatibility: existing configurations without loadBalancing section work unchanged

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - US1 and US2 are independent of each other and can proceed in parallel
  - US3, US4, US5 have overlapping implementations in plan-selector
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Can start after Foundational (Phase 2) - Independent testable
- **User Story 4 (P2)**: Can start after US3 (shares plan-selector modifications)
- **User Story 5 (P3)**: Can start after US4 (completes multi-factor scoring)

### Within Each User Story

- Types before services
- Services before endpoint modifications
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- T004 and T005 can run in parallel (different schema sections)
- T009, T010, T011, T012, T013 can run in parallel (different functions within plan-selector)
- T026 and T027 can run in parallel (different concerns)

---

## Parallel Example: Phase 5 (User Story 3)

```bash
# Launch all strategy implementations together:
Task: "Implement expiration score calculation utility in src/utils/expiration.ts"
Task: "Implement strategy selector function in src/services/plan-selector.ts"
Task: "Implement round-robin strategy in src/services/plan-selector.ts"
Task: "Implement weighted-round-robin strategy in src/services/plan-selector.ts"
Task: "Implement random strategy in src/services/plan-selector.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Passthrough fix)
4. Complete Phase 4: User Story 2 (Consistency verification)
5. **STOP and VALIDATE**: Test passthrough with real requests
6. Deploy if ready - users benefit from passthrough fix immediately

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add US1 + US2 → Test independently → Deploy (Passthrough MVP!)
3. Add US3 → Test independently → Deploy (Fair distribution!)
4. Add US4 → Test independently → Deploy (Expiration priority!)
5. Add US5 → Test independently → Deploy (Full multi-factor LB!)
6. Each story adds value without breaking previous stories

### Sequential Strategy (Recommended)

Since US3, US4, US5 all modify `src/services/plan-selector.ts`, sequential implementation within the plan-selector is recommended:

1. US3: Add strategy pattern + all strategies
2. US4: Add expiration scoring to multi-factor
3. US5: Add RPM tracking and complete multi-factor

---

## Architecture Alignment Notes

This implementation aligns with ADRs from `docs/architecture.md`:

| ADR | Implementation Impact |
|-----|----------------------|
| ADR-001 | All LB logic runs in-memory within single process |
| ADR-002 | Plan config schema extended (expiresOn, expiresAt, weight) |
| ADR-003 | RPM tracking also in-memory with sliding window (lost on restart acceptable) |
| ADR-004 | Both endpoints now have consistent passthrough behavior |
| ADR-005 | Extended with multiple strategies and multi-factor scoring |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Default LB strategy remains "quota-priority" for backward compatibility
- RPM tracking data is in-memory only and lost on restart (acceptable per design)
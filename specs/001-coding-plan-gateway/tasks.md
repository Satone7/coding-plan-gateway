# Tasks: Coding Plan Gateway

**Input**: Design documents from `specs/001-coding-plan-gateway/`
**Prerequisites**: design.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/openapi.yaml ✓

**Tests**: Tests are included following TDD approach as specified in ground-rules.md.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- TypeScript source files use `.ts` extension

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project structure with directories per design.md in src/, tests/
- [x] T002 Initialize Node.js project with TypeScript, Fastify, Vitest, Zod dependencies in package.json
- [x] T003 [P] Configure TypeScript with strict mode in tsconfig.json
- [x] T004 [P] Configure Vitest for testing in vitest.config.ts
- [x] T005 [P] Configure path aliases in tsconfig.json (e.g., @/ → src/)
- [x] T006 [P] Create .env.example with required environment variables

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Core Types & Interfaces

- [x] T007 [P] Create CodingPlan interface in src/types/coding-plan.ts
- [x] T008 [P] Create QuotaState interface in src/types/quota.ts
- [x] T009 [P] Create GatewayRequest internal types in src/types/gateway-request.ts
- [x] T010 [P] Create OpenAI API types in src/types/openai.ts
- [x] T011 [P] Create Anthropic API types in src/types/anthropic.ts
- [x] T012 Create type exports index in src/types/index.ts

### Core Utilities

- [x] T013 [P] Implement encryption utilities (AES-256-GCM) in src/utils/crypto.ts
- [x] T014 [P] Implement structured JSON logger in src/utils/logger.ts
- [x] T015 [P] Create validation helpers using Zod in src/utils/validators.ts

### Configuration Infrastructure

- [x] T016 [P] Create Zod configuration schema in src/config/schema.ts
- [x] T017 [P] Create default configuration values in src/config/defaults.ts
- [x] T018 Implement config loader with environment variable expansion in src/config/index.ts
- [x] T019 Implement encryption module for API keys in src/config/encryption.ts

### Application Bootstrap

- [x] T020 Create Fastify app factory in src/app.ts
- [x] T021 Create application entry point in src/index.ts
- [x] T022 [P] Implement global error handler middleware in src/middleware/error-handler.ts
- [x] T023 [P] Implement request logging middleware in src/middleware/request-logger.ts
- [x] T024 Create route registration aggregator in src/routes/index.ts

### Test Infrastructure

- [x] T025 [P] Create test fixtures for mock plans in tests/fixtures/mock-plans.ts
- [x] T026 [P] Create test fixtures for mock providers in tests/fixtures/mock-providers.ts
- [x] T027 [P] Create unit test for encryption utilities in tests/unit/utils/crypto.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Configure Coding Plans (Priority: P1) 🎯 MVP

**Goal**: Enable users to configure multiple coding plans with CRUD operations that persist across restarts

**Independent Test**: Can be fully tested by adding, editing, and removing coding plan configurations via API and verifying they persist after restart

### Tests for User Story 1

- [x] T028 [P] [US1] Create unit tests for PlanRepository in tests/unit/services/plan-repository.test.ts
- [x] T029 [P] [US1] Create integration tests for plan CRUD endpoints in tests/integration/routes/admin.test.ts

### Implementation for User Story 1

- [x] T030 [P] [US1] Create IPlanRepository interface in src/services/plan-repository.ts
- [x] T031 [US1] Implement FilePlanRepository with YAML persistence in src/services/plan-repository.ts
- [x] T032 [US1] Implement config validation on load in src/config/index.ts
- [x] T033 [US1] Create admin routes registration in src/routes/admin/index.ts
- [x] T034 [US1] Implement plan CRUD handlers in src/routes/admin/handlers.ts
- [x] T035 [US1] Implement POST /api/plans endpoint (create plan)
- [x] T036 [US1] Implement GET /api/plans endpoint (list plans)
- [x] T037 [US1] Implement GET /api/plans/:planId endpoint (get plan)
- [x] T038 [US1] Implement PUT /api/plans/:planId endpoint (update plan)
- [x] T039 [US1] Implement DELETE /api/plans/:planId endpoint (delete plan)
- [x] T040 [US1] Add encryption/decryption of API keys in plan handlers

**Checkpoint**: User Story 1 complete - can create, read, update, delete coding plans via API

---

## Phase 4: User Story 4 - Provide Compatible API Endpoints (Priority: P1)

**Goal**: Provide OpenAI and Anthropic compatible API endpoints for seamless integration with existing AI tools

**Independent Test**: Can be tested by sending OpenAI-format and Anthropic-format requests to the gateway and receiving valid responses

**Dependencies**: Requires US1 (plans must be configurable)

### Tests for User Story 4

- [ ] T041 [P] [US4] Create integration tests for OpenAI endpoint in tests/integration/routes/openai.test.ts
- [ ] T042 [P] [US4] Create integration tests for Anthropic endpoint in tests/integration/routes/anthropic.test.ts
- [ ] T043 [P] [US4] Create unit tests for RequestProxy in tests/unit/services/request-proxy.test.ts

### Implementation for User Story 4

- [ ] T044 [P] [US4] Implement RequestProxy service for upstream forwarding in src/services/request-proxy.ts
- [ ] T045 [US4] Create OpenAI routes registration in src/routes/openai/index.ts
- [ ] T046 [US4] Implement OpenAI chat completions handler in src/routes/openai/handlers.ts
- [ ] T047 [US4] Implement POST /v1/chat/completions endpoint (non-streaming)
- [ ] T048 [US4] Implement streaming support for OpenAI endpoint (SSE)
- [ ] T049 [US4] Implement GET /v1/models endpoint (list available models)
- [ ] T050 [US4] Create Anthropic routes registration in src/routes/anthropic/index.ts
- [ ] T051 [US4] Implement Anthropic messages handler in src/routes/anthropic/handlers.ts
- [ ] T052 [US4] Implement POST /v1/messages endpoint (non-streaming)
- [ ] T053 [US4] Implement streaming support for Anthropic endpoint (SSE)
- [ ] T054 [US4] Add request/response transformation between formats

**Checkpoint**: User Story 4 complete - gateway accepts OpenAI and Anthropic format requests

---

## Phase 5: User Story 2 - Route Requests by Model (Priority: P1)

**Goal**: Automatically route requests to appropriate coding plans based on model availability

**Independent Test**: Can be tested by configuring plans with different model lists and verifying requests are routed to plans supporting the requested model

**Dependencies**: Requires US1 (plans) and US4 (endpoints)

### Tests for User Story 2

- [ ] T055 [P] [US2] Create unit tests for PlanSelector in tests/unit/services/plan-selector.test.ts
- [ ] T056 [P] [US2] Create unit tests for RequestRouter in tests/unit/services/request-router.test.ts

### Implementation for User Story 2

- [ ] T057 [P] [US2] Implement PlanSelector service (select plan by model) in src/services/plan-selector.ts
- [ ] T058 [US2] Implement model resolution logic (find plans supporting model) in src/services/plan-selector.ts
- [ ] T059 [US2] Implement RequestRouter service in src/services/request-router.ts
- [ ] T060 [US2] Integrate RequestRouter with OpenAI handler in src/routes/openai/handlers.ts
- [ ] T061 [US2] Integrate RequestRouter with Anthropic handler in src/routes/anthropic/handlers.ts
- [ ] T062 [US2] Implement error response for unsupported models (404 MODEL_NOT_FOUND)
- [ ] T063 [US2] Implement CircuitBreaker for provider failure handling in src/services/circuit-breaker.ts
- [ ] T064 [US2] Add automatic failover to alternative plans on provider error

**Checkpoint**: User Story 2 complete - requests automatically routed to plans supporting the model

---

## Phase 6: User Story 3 - Track and Prioritize by Quota (Priority: P2)

**Goal**: Track usage quota and prioritize plans with highest remaining quota

**Independent Test**: Can be tested by configuring quotas, making requests, and verifying quota tracking and plan selection prioritizes higher quota

**Dependencies**: Requires US2 (routing to track usage)

### Tests for User Story 3

- [ ] T065 [P] [US3] Create unit tests for QuotaManager in tests/unit/services/quota-manager.test.ts
- [ ] T066 [P] [US3] Create integration tests for quota endpoints in tests/integration/routes/admin.test.ts

### Implementation for User Story 3

- [ ] T067 [US3] Implement QuotaManager service in src/services/quota-manager.ts
- [ ] T068 [US3] Implement quota tracking on request completion in QuotaManager
- [ ] T069 [US3] Implement quota persistence to JSON file in QuotaManager
- [ ] T070 [US3] Implement quota-based plan selection (highest remaining first) in src/services/plan-selector.ts
- [ ] T071 [US3] Add QuotaManager integration to RequestRouter
- [ ] T072 [US3] Implement GET /api/quota/:planId endpoint (get quota status)
- [ ] T073 [US3] Implement POST /api/quota/:planId/reset endpoint (reset quota)
- [ ] T074 [US3] Handle quota exhaustion error (429 QUOTA_EXHAUSTED)
- [ ] T075 [US3] Implement periodic quota persistence (every 60 seconds)
- [ ] T076 [US3] Implement graceful shutdown with quota save

**Checkpoint**: User Story 3 complete - quota tracked, plans prioritized by remaining quota

---

## Phase 7: User Story 5 - View Usage Statistics (Priority: P3)

**Goal**: Provide usage statistics for monitoring and optimization

**Independent Test**: Can be tested by making requests and verifying statistics are accurately recorded

**Dependencies**: Requires US3 (quota tracking for data)

### Implementation for User Story 5

- [ ] T077 [P] [US5] Enhance request logging with token usage in src/middleware/request-logger.ts
- [ ] T078 [US5] Add per-request timing metrics to logs
- [ ] T079 [US5] Add provider response time tracking in RequestProxy
- [ ] T080 [US5] Enhance GET /api/plans to include quota usage statistics

**Checkpoint**: User Story 5 complete - usage statistics available for monitoring

---

## Phase 8: Health & Polish

**Purpose**: Health endpoints and cross-cutting improvements

### Health Endpoints

- [ ] T081 [P] Implement GET /health endpoint in src/routes/health/index.ts
- [ ] T082 [P] Implement GET /ready endpoint (readiness check) in src/routes/health/index.ts

### Documentation & Validation

- [ ] T083 [P] Validate quickstart.md instructions work end-to-end
- [ ] T084 Create README.md with quick start, configuration, and API reference
- [ ] T085 Add JSDoc comments to public APIs

### Docker & Deployment

- [ ] T086 Create Dockerfile for containerized deployment
- [ ] T087 Create docker-compose.yaml for local development
- [ ] T088 Add npm scripts for start, reload, config validate

### Final Validation

- [ ] T089 Run full test suite and verify 80%+ coverage
- [ ] T090 Run linting and fix any issues
- [ ] T091 Run quickstart.md validation with real provider

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational) ← BLOCKS all user stories
    ↓
Phase 3 (US1 - Configure Plans) ← Foundation for all other stories
    ↓
Phase 4 (US4 - API Endpoints) ← Needs US1 plans
    ↓
Phase 5 (US2 - Routing) ← Needs US1 plans + US4 endpoints
    ↓
Phase 6 (US3 - Quota) ← Needs US2 routing
    ↓
Phase 7 (US5 - Statistics) ← Needs US3 quota data
    ↓
Phase 8 (Health & Polish)
```

### User Story Dependencies

| Story | Depends On | Can Start After |
|-------|------------|-----------------|
| US1 (Configure Plans) | Foundational | Phase 2 complete |
| US4 (API Endpoints) | US1 | Phase 3 complete |
| US2 (Routing) | US1, US4 | Phase 4 complete |
| US3 (Quota) | US2 | Phase 5 complete |
| US5 (Statistics) | US3 | Phase 6 complete |

### Parallel Opportunities Within Phases

**Phase 1**: T003, T004, T005, T006 can run in parallel
**Phase 2**: T007-T012 (types) can all run in parallel; T013-T015 (utils) can run in parallel; T025-T027 (tests) can run in parallel
**Phase 3**: T028, T029 (tests) can run in parallel
**Phase 4**: T041-T043 (tests) can run in parallel
**Phase 5**: T055, T056 (tests) can run in parallel
**Phase 6**: T065, T066 (tests) can run in parallel
**Phase 7**: T077-T079 can run in parallel
**Phase 8**: T081, T082, T083, T085 can run in parallel

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch all type definitions in parallel:
Task: "Create CodingPlan interface in src/types/coding-plan.ts"
Task: "Create QuotaState interface in src/types/quota.ts"
Task: "Create GatewayRequest internal types in src/types/gateway-request.ts"
Task: "Create OpenAI API types in src/types/openai.ts"
Task: "Create Anthropic API types in src/types/anthropic.ts"

# Launch all utilities in parallel:
Task: "Implement encryption utilities in src/utils/crypto.ts"
Task: "Implement structured JSON logger in src/utils/logger.ts"
Task: "Create validation helpers using Zod in src/utils/validators.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1, 4, 2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Configure Plans)
4. Complete Phase 4: User Story 4 (API Endpoints)
5. Complete Phase 5: User Story 2 (Routing)
6. **STOP and VALIDATE**: Test full request flow end-to-end
7. Deploy MVP - functional gateway with routing

### Incremental Delivery

| Increment | Stories Complete | Value Delivered |
|-----------|-----------------|-----------------|
| Increment 1 | US1 | Can configure plans |
| Increment 2 | US1 + US4 | Can send requests to endpoints |
| Increment 3 | US1 + US4 + US2 | Full routing functionality |
| Increment 4 | + US3 | Quota management |
| Increment 5 | + US5 | Usage statistics |
| Increment 6 | + Health/Polish | Production-ready |

### MVP Scope (Recommended)

- **Include**: Setup, Foundational, US1, US4, US2
- **Exclude**: US3, US5, Polish (add in subsequent iterations)
- **Result**: Functional gateway that routes requests by model

---

## Task Summary

| Phase | Task Count | Parallel Tasks |
|-------|------------|----------------|
| Phase 1: Setup | 6 | 4 |
| Phase 2: Foundational | 21 | 13 |
| Phase 3: US1 - Configure Plans | 13 | 2 |
| Phase 4: US4 - API Endpoints | 14 | 3 |
| Phase 5: US2 - Routing | 10 | 2 |
| Phase 6: US3 - Quota | 12 | 2 |
| Phase 7: US5 - Statistics | 4 | 1 |
| Phase 8: Health & Polish | 11 | 4 |
| **Total** | **91** | **31** |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Tests written FIRST following TDD approach
- Commit after each task or logical group
- Stop at any checkpoint to validate independently
- Follow coding standards from docs/standards.md
- Run tests after each task completion
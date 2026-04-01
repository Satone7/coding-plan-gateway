# Tasks: Docker Auto-Update

**Branch**: `016-docker-auto-update` | **Date**: 2026-03-31

---

## Implementation Strategy

**MVP Scope**: User Story 1 (P1) - Automatic Update Detection and Application

**Approach**: 
- Build shell-based auto-update system as Docker entrypoint
- Extend existing Dockerfile with auto-update capabilities
- Implement git-based update detection and npm build process
- Ensure robust error handling with automatic fallback

**Test-Driven**: No test tasks included (not requested in specification)

---

## Dependency Graph

```
Phase 1: Setup
├── T001: Create directory structure
└── T002: Create shared logging library

Phase 2: Foundational (MUST complete before US1)
├── T003: Create git operations library
├── T004: Create build automation library
├── T005: Create health check library
└── T006: Create backup/rollback library

Phase 3: US1 - Automatic Update Detection (P1 - MVP)
├── T007: Create main entrypoint script
├── T008: Implement update check flow
├── T009: Implement build and deploy flow
├── T010: Implement error handling and rollback
└── T011: Create extended Dockerfile

Phase 4: US2 - Manual Update Trigger (P2)
├── T012: Add signal handler for manual trigger
└── T013: Create manual check script

Phase 5: US3 - Update Failure Handling (P3)
├── T014: Implement health verification
└── T015: Add retry logic with exponential backoff

Phase 6: Polish
├── T016: Create comprehensive documentation
├── T017: Create example docker-compose files
└── T018: Final integration testing
```

---

## Phase 1: Setup

**Goal**: Create project structure and shared utilities

### Tasks

- [ ] T001 Create directory structure in docker/autoupdate/ with lib/ subdirectory per project structure
- [ ] T002 Create shared logging library docker/autoupdate/lib/logging.sh with structured JSON output

---

## Phase 2: Foundational (Blocking for US1)

**Goal**: Build core libraries that all user stories depend on

### Tasks

- [ ] T003 Create git operations library docker/autoupdate/lib/git.sh supporting HTTPS token and SSH key auth
- [ ] T004 Create build automation library docker/autoupdate/lib/build.sh for npm ci and npm run build
- [ ] T005 Create health check library docker/autoupdate/lib/health.sh for service readiness verification
- [ ] T006 Create backup/rollback library docker/autoupdate/lib/rollback.sh for atomic build swaps

---

## Phase 3: US1 - Automatic Update Detection (P1 - MVP)

**Story Goal**: Enable automatic check, pull, build, and start on container startup

**Independent Test Criteria**: 
- Container starts within 30 seconds when no updates available
- Container successfully pulls, builds, and starts when updates available
- Service remains available (on existing build) if update fails

### Tasks

- [ ] T007 [US1] Create main entrypoint script docker/autoupdate/entrypoint.sh that orchestrates update flow
- [ ] T008 [US1] Implement update check flow in entrypoint comparing local and remote commits
- [ ] T009 [US1] Implement build and deploy flow triggering npm build and atomic swap on success
- [ ] T010 [US1] Implement error handling and rollback catching failures and restoring backup
- [ ] T011 [US1] Create extended Dockerfile docker/autoupdate/Dockerfile.autoupdate based on existing production Dockerfile

---

## Phase 4: US2 - Manual Update Trigger (P2)

**Story Goal**: Allow runtime manual trigger via signals or endpoints

**Independent Test Criteria**:
- Signal (SIGUSR1) triggers update check within 5 seconds
- Manual check completes full update cycle when updates available

### Tasks

- [ ] T012 [US2] Add signal handler for manual trigger in entrypoint.sh listening for SIGUSR1
- [ ] T013 [US2] Create manual check script scripts/autoupdate-check.sh for CLI-based manual trigger

---

## Phase 5: US3 - Update Failure Handling (P3)

**Story Goal**: Robust handling of network, build, and runtime failures

**Independent Test Criteria**:
- Network failure during update: service starts with existing build within 10 seconds
- Build failure: automatic rollback to last known good within 10 seconds
- New build crashes on start: automatic rollback within 30 seconds

### Tasks

- [ ] T014 [US3] Implement health verification in health.sh verifying service responds before confirming update success
- [ ] T015 [US3] Add retry logic with exponential backoff in entrypoint.sh for transient failures like network timeouts

---

## Phase 6: Polish

**Goal**: Documentation, examples, and final validation

### Tasks

- [ ] T016 Create comprehensive documentation in docker/autoupdate/README.md with architecture and troubleshooting
- [ ] T017 Create example docker-compose files docker/autoupdate/examples/docker-compose.{https,ssh}.yml
- [ ] T018 Final integration testing running full update cycle in test environment

---

## Parallel Execution Opportunities

### Can Run in Parallel (Same Phase)

**Phase 2 (Foundational)**:
- T003 (git.sh), T004 (build.sh), T005 (health.sh), T006 (rollback.sh)
- No dependencies between libraries

**Phase 3 (US1)**:
- T007, T008, T009, T010 are sequential (same flow)
- T011 (Dockerfile) can be done in parallel with T007-T010

**Phase 4 (US2)**:
- T012 and T013 can be done in parallel

**Phase 5 (US3)**:
- T014 and T015 can be done in parallel

### Must Run Sequentially (Dependencies)

1. Phase 1 → Phase 2 (need directory structure)
2. Phase 2 → Phase 3 (need libraries for entrypoint)
3. Phase 3 → Phase 4 (need entrypoint for signal handler)
4. Phase 4 → Phase 5 (signal handler needs update flow)

---

## Task Dependency Summary

```
T001 → T002 → T003, T004, T005, T006 (parallel)
                        ↓
              T007 → T008 → T009 → T010
                        ↓              ↘
              T011 (parallel)             T012, T013 (parallel)
                                             ↓
                                        T014, T015 (parallel)
                                             ↓
                                        T016, T017, T018 (parallel)
```


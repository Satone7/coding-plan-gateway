# Technical Design: E2E Docker Testing Environment

**Branch**: `003-e2e-docker-testing` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-e2e-docker-testing/spec.md`

## Summary

Create a Docker-based e2e testing environment that runs Claude Code in a container configured to use the coding-plan-gateway service. The environment provides isolated, reproducible testing with mounted configuration files and persistent logs for debugging.

---

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+ LTS (infrastructure scripts), Dockerfile (container definitions)
**Primary Dependencies**: Docker, Docker Compose v2, @anthropic-ai/claude-code (npm package)
**Storage**: File-based (YAML config mounts, log volumes)
**Testing**: Manual interactive testing via containerized Claude Code
**Target Platform**: Docker on local development machine (Linux/macOS/Windows)
**Project Type**: Infrastructure / Developer Tooling
**Performance Goals**: Environment startup < 60 seconds, container health check < 10 seconds
**Constraints**: Single-host deployment, localhost-only networking, no cloud dependencies
**Scale/Scope**: Single developer testing session, 2 containers (gateway + claude-code)

---

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Check

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Code Quality** | ✅ PASS | Shell scripts follow project conventions; Dockerfile uses minimal base image |
| **II. Testing** | ✅ PASS | Feature IS a testing environment; infrastructure tested via successful startup |
| **III. User Experience** | ✅ PASS | Single command to start; clear error messages; troubleshooting guide |
| **IV. Performance** | ✅ PASS | Startup < 60s meets target; no runtime performance requirements |
| **Security** | ✅ PASS | Config file gitignored; API keys via mounted file; no secrets in images |
| **Workflow** | ✅ PASS | npm scripts for lifecycle; conventional commit format |

### Post-Design Check

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Code Quality** | ✅ PASS | Simple scripts with single responsibility; clear naming conventions |
| **II. Testing** | ✅ PASS | Environment provides testing capability; health checks verify correctness |
| **III. User Experience** | ✅ PASS | quickstart.md provides clear instructions; error messages documented |
| **IV. Performance** | ✅ PASS | Docker Compose parallel startup; health check optimization |
| **Security** | ✅ PASS | .gitignore entries for test-config.yaml and logs/; no secrets in compose file |
| **Workflow** | ✅ PASS | All changes via conventional commits; documentation in specs/ |

**Gate Status**: ✅ ALL PASS - Proceed with implementation

---

## Project Structure

### Documentation (this feature)

```text
specs/003-e2e-docker-testing/
├── spec.md              # Feature specification
├── design.md            # This file
├── research.md          # Phase 0 research findings
├── data-model.md        # Configuration and log data structures
├── quickstart.md        # Developer quick start guide
├── contracts/           # Interface contracts
│   └── npm-scripts.md   # NPM scripts contract
└── tasks.md             # Implementation tasks (via /rainbow.taskify)
```

### Source Code (repository root)

```text
e2e/
├── Dockerfile              # Claude Code container definition
├── test-config.example.yaml # Configuration template (committed)
├── test-config.yaml        # Developer's config (gitignored)
├── workspace/              # Mounted test workspace
│   └── .gitkeep
└── README.md               # E2E testing guide

scripts/
└── e2e/
    ├── start.sh            # Start environment script
    ├── stop.sh             # Stop environment script
    ├── reset.sh            # Reset environment script
    └── status.sh           # Status check script

logs/
├── gateway/                # Gateway logs (gitignored)
│   └── .gitkeep
└── claude-code/            # Claude Code logs (gitignored)
    └── .gitkeep

docker-compose.e2e.yml      # Docker Compose configuration

package.json                # NPM scripts added:
                           #   e2e:start, e2e:stop, e2e:reset, e2e:logs, e2e:status

.gitignore                 # Add entries for:
                           #   e2e/test-config.yaml
                           #   logs/
```

**Structure Decision**: Infrastructure files placed in `e2e/` directory at repository root. Scripts in `scripts/e2e/` following project conventions. This isolates e2e testing infrastructure from production code while maintaining discoverability.

---

## Architecture Decisions

### ADR-E2E-001: Single Docker Compose File

**Context**: Need to orchestrate gateway and Claude Code containers together.

**Decision**: Use a single `docker-compose.e2e.yml` file for all services.

**Rationale**: Simpler for developers (one command), easier to maintain, aligns with clarification.

**Consequences**: All services in one file; clear dependency chain via `depends_on`.

---

### ADR-E2E-002: Config File Mount (Not Environment Variables)

**Context**: API keys need to be provided to the gateway.

**Decision**: Mount YAML configuration file containing API keys.

**Rationale**: Aligns with project's existing config approach (ADR-002: File-Based Configuration); allows hot-reload; separates secrets from Docker images.

**Consequences**: Config file must be gitignored; template file provided for developers to copy.

---

### ADR-E2E-003: Host-Mounted Log Volumes

**Context**: Logs need to be accessible for debugging.

**Decision**: Mount host directories as volumes for log storage.

**Rationale**: Developers can use host tools (grep, editors); logs persist after container cleanup; aligns with clarification.

**Consequences**: Log directories must be gitignored; `.gitkeep` files to preserve structure.

---

## Component Design

### Docker Compose Services

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Network                    │
│                      (e2e-network)                           │
│                                                              │
│  ┌──────────────────┐           ┌──────────────────┐        │
│  │    gateway       │           │   claude-code    │        │
│  │    :8080         │◄──────────│                  │        │
│  │                  │  HTTP     │  Claude Code CLI │        │
│  │  - config mount  │           │  - ENV vars      │        │
│  │  - logs mount    │           │  - logs mount    │        │
│  │  - health check  │           │  - workspace     │        │
│  └──────────────────┘           └──────────────────┘        │
│          │                              │                    │
│          ▼                              ▼                    │
│  ┌─────────────────────────────────────────────────┐        │
│  │              Host-Mounted Volumes               │        │
│  │  ./e2e/test-config.yaml  → /app/config.yaml     │        │
│  │  ./logs/gateway          → /app/logs            │        │
│  │  ./logs/claude-code      → /root/.claude/logs   │        │
│  │  ./e2e/workspace         → /workspace           │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Lifecycle Flow

```
Developer
    │
    ├── npm run e2e:start ──────► Build images
    │                                 │
    │                                 ▼
    │                            Start containers
    │                                 │
    │                                 ▼
    │                            Health check (gateway)
    │                                 │
    │                                 ▼
    │                            Environment ready
    │                                 │
    ├── docker exec -it claude-code claude
    │                                 │
    │                                 ▼
    │                            Interactive testing
    │                                 │
    ├── npm run e2e:logs ◄────────────┘
    │       (view logs)
    │
    └── npm run e2e:stop ──────► Stop containers
```

---

## Complexity Tracking

> No violations requiring justification. All design decisions follow project ground-rules.

---

## Implementation Notes

1. **Dockerfile**: Use `node:20-bookworm-slim` base image, install `@anthropic-ai/claude-code` globally
2. **Health Check**: Gateway must respond to `/health` before Claude Code starts
3. **Network**: Default bridge network with service name DNS resolution
4. **Scripts**: Bash scripts for cross-platform compatibility (with PowerShell alternatives if needed)

---

## Related Documents

- [research.md](./research.md) - Research findings and decisions
- [data-model.md](./data-model.md) - Configuration and log structures
- [quickstart.md](./quickstart.md) - Developer quick start guide
- [contracts/npm-scripts.md](./contracts/npm-scripts.md) - NPM scripts contract
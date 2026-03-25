# Technical Design: CPG CLI Executable

**Branch**: `006-cpg-cli` | **Date**: 2026-03-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/006-cpg-cli/spec.md`

## Summary

Create a standalone CLI executable `cpg` that provides a unified interface for gateway management operations. The CLI will support key management commands (`key create`, `key list`, `key test`, etc.), usage reporting, and integration with Docker containers. Key feature: API keys created via CLI are immediately available in the running gateway through an internal notification API.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Commander.js (CLI framework), Zod (validation), bcrypt (key hashing)
**Storage**: JSON files (api-keys.json, usage-data.json)
**Testing**: Vitest
**Target Platform**: Linux (Docker containers), macOS, Windows
**Project Type**: Single project (monolithic)
**Performance Goals**: CLI commands < 1 second, key availability < 100ms after creation
**Constraints**: No additional runtime dependencies beyond Node.js, works in Docker containers
**Scale/Scope**: Single-user deployment, 10+ API keys typical usage

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Code Quality
- [x] All code MUST follow project's established linting and formatting standards
- [x] Functions and components MUST have a single responsibility
- [x] Naming MUST be descriptive and consistent throughout the codebase
- [x] Complexity MUST be justified; simpler alternatives MUST be considered first
- [x] Dead code, commented-out code, and unused dependencies MUST be removed
- [x] Code MUST be self-documenting; comments reserved for "why" not "what"

### II. Testing
- [x] All new features MUST include corresponding tests
- [x] Tests MUST be independent, isolated, and repeatable
- [x] Test coverage MUST NOT decrease on any PR merge
- [x] Integration tests MUST validate component interactions at boundaries

### III. User Experience
- [x] Error messages MUST be clear, actionable, and user-friendly
- [x] Response times MUST meet defined performance targets (< 1s for CLI commands)
- [x] User interfaces MUST be consistent with established design patterns
- [x] New features MUST include user-facing documentation

### IV. Performance
- [x] All endpoints MUST respond within defined latency targets
- [x] Performance regressions MUST be detected in CI/CD before merge
- [x] Large operations MUST implement pagination or streaming

### Security Requirements
- [x] All inputs MUST be validated and sanitized
- [x] Internal API endpoints MUST bind to localhost only
- [x] OWASP Top 10 vulnerabilities MUST be actively prevented

### Development Workflow
- [x] All changes MUST go through pull request review
- [x] Pull requests MUST be small, focused, and include clear descriptions
- [x] All commits MUST follow conventional commit message format

## Project Structure

### Documentation (this feature)

```text
specs/006-cpg-cli/
├── design.md            # This file (/rainbow.design command output)
├── research.md          # Phase 0 output (/rainbow.design command)
├── data-model.md        # Phase 1 output (/rainbow.design command)
├── quickstart.md        # Phase 1 output (/rainbow.design command)
├── contracts/           # Phase 1 output (/rainbow.design command)
└── tasks.md             # Phase 2 output (/rainbow.taskify command)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── index.ts           # CLI entry point (cpg executable)
│   ├── commands/          # Command handlers
│   │   ├── key.ts         # key create, list, disable, enable, delete, test
│   │   └── usage.ts       # usage-report command
│   ├── output/            # Output formatters
│   │   ├── json.ts        # JSON output formatter
│   │   └── table.ts       # Human-readable table formatter
│   └── api-key-cli.ts     # Existing CLI logic (refactored)

├── services/
│   ├── api-key-manager.ts # Existing (unchanged)
│   ├── usage-tracker.ts   # Existing (unchanged)
│   └── gateway-notifier.ts # NEW: Notify gateway of storage changes

├── routes/
│   └── internal/
│       ├── index.ts       # Existing internal routes
│       ├── api-keys.ts    # Existing API key routes
│       └── reload.ts      # NEW: /internal/reload endpoint

├── types/
│   └── cli.ts             # NEW: CLI-specific types

bin/
└── cpg                    # NEW: Executable shell script

tests/
├── unit/
│   └── cli/
│       ├── commands/
│       │   ├── key.test.ts
│       │   └── usage.test.ts
│       └── output/
│           ├── json.test.ts
│           └── table.test.ts
└── integration/
    └── cli/
        └── cli-integration.test.ts
```

**Structure Decision**: Single project structure maintaining consistency with existing codebase. CLI code placed in `src/cli/` directory following existing patterns. New `bin/` directory for executable entry point.

## Complexity Tracking

> No violations requiring justification. All design decisions align with ground-rules.
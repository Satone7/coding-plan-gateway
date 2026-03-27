# Coding Plan Gateway - Project Context

> This file provides essential context for AI agents working on this project.

## Project Overview

**Coding Plan Gateway** - A load balancer for managing multiple AI coding plan subscriptions. Routes requests to appropriate providers based on model availability and quota, exposing OpenAI and Anthropic compatible APIs.

## Technology Stack

- **Runtime**: Node.js 20+ LTS
- **Framework**: Fastify 4.x
- **Language**: TypeScript 5.x
- **Testing**: Vitest
- **Deployment**: Docker, local

## Key Architecture Decisions

- Monolithic single-process architecture
- File-based configuration storage (YAML)
- In-memory quota tracking with periodic persistence
- Dual API format support (OpenAI + Anthropic)
- Quota-based load balancing

## Quick Reference

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions | camelCase, verb-first | `calculateQuota` |
| Variables | camelCase | `requestCount` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Classes/Types | PascalCase | `QuotaManager` |
| Interfaces | PascalCase (no I prefix) | `CodingPlan` |
| Files | kebab-case.ts | `quota-manager.ts` |
| Test files | *.test.ts | `quota-manager.test.ts` |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/messages` | POST | Anthropic-compatible messages |
| `/v1/models` | GET | List available models |
| `/api/plans` | CRUD | Manage coding plans |
| `/health` | GET | Health check |

### Code Style

- **Indent**: 2 spaces
- **Line length**: 100 chars max
- **Semicolons**: Required
- **Quotes**: Single
- **Strict TypeScript**: Enabled

### Commit Convention

Follow Conventional Commits: `type(scope): description`

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

### Git Merge Rules

**ALWAYS use `--no-ff` (no fast-forward) for merging feature branches.**

```bash
git checkout master
git merge <branch-name> --no-ff -m "merge: branch <branch-name> into master"
```

**Why `--no-ff`:**

| Aspect | `--no-ff` (Required) | `--squash` (Avoid) |
|--------|---------------------|-------------------|
| Commit type | Merge commit (2 parents) | Regular commit (1 parent) |
| Branch history | Preserved in git graph | Lost |
| Revertability | Easy to revert entire feature | Difficult |
| Traceability | Clear feature boundaries | No feature context |

**Benefits of `--no-ff`:**
- Branch appears as separate line in git graph
- All feature commits remain grouped
- Easy to identify which commits belong to which feature
- Can revert entire feature with one command: `git revert -m 1 <merge-commit>`

## Documentation References

- **Standards**: `docs/standards.md` - Complete coding standards
- **Architecture**: `docs/architecture.md` - System design decisions
- **Ground-rules**: `memory/ground-rules.md` - Project principles
- **Specification**: `specs/001-coding-plan-gateway/spec.md` - Feature requirements

## Development Workflow

1. Create feature branch from `main`
2. Write tests first (TDD encouraged)
3. Implement with standards compliance
4. Run lint, type-check, tests
5. Create PR with conventional commit style
6. Merge after review approval

## Security Requirements

- Validate ALL inputs at boundaries
- Encrypt API keys at rest (AES-256)
- Never log or commit secrets
- Use environment variables for sensitive config
- **CRITICAL: NEVER commit API keys or secrets to git**
  - `config.yaml` is in `.gitignore` for this reason
  - Always use placeholder values like `YOUR_API_KEY_HERE` in example files
  - If API keys are accidentally committed, rotate them immediately and use `git filter-repo` or BFG to remove from history

## Testing Requirements

- Unit test coverage: 80% minimum
- AAA pattern (Arrange-Act-Assert)
- Tests must be independent and isolated
- Critical paths require 100% coverage

## Active Technologies
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Vitest, Zod (validation), MSW (mocking) (001-coding-plan-gateway)
- YAML/JSON files (current), PostgreSQL with Drizzle ORM (future migration path prepared) (001-coding-plan-gateway)
- TypeScript 5.x, Node.js 20+ LTS + Fastify 4.x, Vitest, Zod, ESLint (002-fix-task-completion-issues)
- YAML/JSON file-based configuration (002-fix-task-completion-issues)
- TypeScript 5.x / Node.js 20+ LTS (infrastructure scripts), Dockerfile (container definitions) + Docker, Docker Compose v2, @anthropic-ai/claude-code (npm package) (003-e2e-docker-testing)
- File-based (YAML config mounts, log volumes) (003-e2e-docker-testing)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Zod (validation), Vitest (testing) (004-fix-e2e-exec)
- YAML/JSON files (configuration), in-memory (quota tracking) (004-fix-e2e-exec)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Zod (validation), bcrypt (key hashing), uuid (key ID generation) (005-api-key-management)
- JSON files (api-keys.json for key metadata, usage-data.json for usage records) (005-api-key-management)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Commander.js (CLI framework), Zod (validation), bcrypt (key hashing) (006-cpg-cli)
- JSON files (api-keys.json, usage-data.json) (006-cpg-cli)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Zod (validation), Vitest (testing), Docker (E2E) (007-fix-cli-reload)
- JSON files (`api-keys.json`, `usage-data.json`) in Docker named volume (007-fix-cli-reload)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Zod (validation), Commander.js (CLI), Vitest (testing) (008-plan-usage-stats)
- JSON files (plan-usage-data.json, usage-adjustment-history.json) (008-plan-usage-stats)
- YAML/JSON files (configuration), in-memory (RPM tracking, quota state) (009-enhance-routing-lb)
- TypeScript 5.x (strict mode) + Fastify 4.x, Zod (validation), Vitest (testing) (010-plan-id-int)
- JSON files (config.json, plan-id-counter.json, quota-state.json) (010-plan-id-int)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Zod (validation), Vitest (testing), bcrypt (key hashing) (011-fix-usage-tracking)
- JSON files (`plan-usage-data.json`, `usage-adjustment-history.json`) (011-fix-usage-tracking)
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x (existing), no new dependencies required (012-request-latency-tracing)
- In-memory per-request timing state (no persistence required) (012-request-latency-tracing)

## Recent Changes
- 007-fix-cli-reload: Fixed CLI reload endpoint registration, authentication exemption for internal routes, x-api-key header support
- 001-coding-plan-gateway: Added TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Vitest, Zod (validation), MSW (mocking)

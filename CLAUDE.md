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

## Testing Requirements

- Unit test coverage: 80% minimum
- AAA pattern (Arrange-Act-Assert)
- Tests must be independent and isolated
- Critical paths require 100% coverage

## Active Technologies
- TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Vitest, Zod (validation), MSW (mocking) (001-coding-plan-gateway)
- YAML/JSON files (current), PostgreSQL with Drizzle ORM (future migration path prepared) (001-coding-plan-gateway)

## Recent Changes
- 001-coding-plan-gateway: Added TypeScript 5.x (strict mode) on Node.js 20+ LTS + Fastify 4.x, Vitest, Zod (validation), MSW (mocking)

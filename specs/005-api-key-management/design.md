# Technical Design: API Key Management

**Branch**: `005-api-key-management` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/005-api-key-management/spec.md`

## Summary

Implement API key authentication and usage tracking for the Coding Plan Gateway. The feature adds a security layer that validates API keys on all incoming requests (except health checks), provides CLI commands for key management, tracks per-key usage metrics, and persists usage data with daily aggregation. Keys are stored as bcrypt hashes for security, and usage is persisted to JSON files with periodic sync.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), bcrypt (key hashing), uuid (key ID generation)
**Storage**: JSON files (api-keys.json for key metadata, usage-data.json for usage records)
**Testing**: Vitest with MSW for mocking
**Target Platform**: Linux server (Docker or bare-metal Node.js)
**Project Type**: single
**Performance Goals**: Key validation <5ms, usage tracking adds <10ms latency, CLI commands <1s
**Constraints**: Single-user local deployment, no external auth provider, file-based storage
**Scale/Scope**: Thousands of records (not millions), 10+ API keys, daily usage aggregation

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality** | PASS | Will follow existing patterns (services, types, utils structure), single responsibility per service |
| **II. Testing** | PASS | Will add unit tests for all new services, integration tests for auth middleware |
| **III. User Experience** | PASS | CLI commands will have clear help text, error messages will be actionable |
| **IV. Performance** | PASS | In-memory key validation <5ms, async persistence won't block requests |
| **Security Requirements** | PASS | Keys stored as bcrypt hashes, validation uses constant-time comparison, all inputs validated |
| **Development Workflow** | PASS | Feature branch, conventional commits, PR review required |

**Gate Status**: PASSED - No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/005-api-key-management/
├── design.md            # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-key-api.yaml # OpenAPI spec for CLI commands
└── tasks.md             # Phase 2 output (/rainbow.taskify)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── api-key-manager.ts      # Core service for key CRUD operations
│   └── usage-tracker.ts        # Usage tracking and persistence
├── middleware/
│   └── auth.ts                 # API key validation middleware
├── cli/
│   └── api-key-cli.ts          # CLI commands for key management
├── types/
│   ├── api-key.ts              # API key type definitions
│   └── usage.ts                # Usage record type definitions
├── config/
│   └── auth-config.ts          # Authentication configuration
└── utils/
    └── key-generator.ts        # Cryptographic key generation

tests/
├── unit/
│   ├── api-key-manager.test.ts
│   ├── usage-tracker.test.ts
│   └── auth-middleware.test.ts
├── integration/
│   └── auth-flow.test.ts
└── contract/
    └── api-key-cli.test.ts
```

**Structure Decision**: Single project structure, following existing patterns with new services in `src/services/`, middleware in `src/middleware/`, CLI commands in `src/cli/`, and types in `src/types/`.

## Design Decisions

### D1: API Key Format

- **Format**: `cpg_<random-32-chars>` (e.g., `cpg_abc123def456ghi789jkl012mno345pqr`)
- **Prefix**: `cpg_` identifies keys from Coding Plan Gateway
- **Random portion**: 32 alphanumeric characters (base62) for 192 bits of entropy
- **Storage**: bcrypt hash with cost factor 12

### D2: Key Identification

- **Key ID**: UUID v4 (e.g., `550e8400-e29b-41d4-a716-446655440000`)
- **Key Prefix Display**: First 8 characters after prefix for UI display (e.g., `cpg_abc12345...`)
- **Purpose**: Allows key identification without exposing full key

### D3: Usage Tracking Granularity

- **Aggregation**: Daily per API key
- **Metrics**: Request count, input tokens, output tokens
- **Storage**: JSON file with structure `{ "YYYY-MM-DD": { keyId: metrics } }`
- **Sync**: Every 60 seconds (configurable), same pattern as QuotaManager

### D4: Authentication Exemptions

- **Always exempt**: `/health`, `/ready`, CLI commands
- **Configurable exempt**: Additional paths via environment variable `AUTH_EXEMPT_PATHS`
- **Pattern matching**: Exact match or prefix match (e.g., `/api/public/*`)

### D5: CLI Command Structure

```
npm run key:create -- --name "My Key" [--expires 2026-12-31]
npm run key:list
npm run key:disable -- --id <uuid>
npm run key:enable -- --id <uuid>
npm run key:delete -- --id <uuid>
npm run usage:report [--key-id <uuid>] [--from 2026-01-01] [--to 2026-03-31]
```

## Complexity Tracking

No complexity violations to justify.
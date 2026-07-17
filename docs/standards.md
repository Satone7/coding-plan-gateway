# Coding Standards: Coding Plan Gateway

**Version**: 1.0 | **Date**: 2026-03-20 | **Status**: Active

**Purpose**: A concise, high-signal standards guide for **AI agents** to ensure consistent, maintainable, and secure code.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Code Naming Conventions](#2-code-naming-conventions)
3. [Files & Directories](#3-files--directories)
4. [API Standards](#4-api-standards)
5. [Testing Standards](#5-testing-standards)
6. [Git Workflow](#6-git-workflow)
7. [Code Style Guide](#7-code-style-guide)
8. [Security Standards](#8-security-standards)
9. [Enforcement & Tools](#9-enforcement--tools)

---

## 1. Executive Summary

- **Stack**: Node.js 20+ LTS, Fastify 4.x, TypeScript 5.x, Vitest, Docker
- **Naming**: Functions/variables (camelCase), constants (SCREAMING_SNAKE_CASE), classes/types/interfaces (PascalCase), files (kebab-case.ts), endpoints (kebab-case)
- **Architecture**: Monolithic single-process API gateway with in-memory quota tracking and file-based configuration
- **Key Principle**: Maximize readability, simplicity, and long-term maintainability

---

## 2. Code Naming Conventions

### 2.1 Variables

| Type | Convention | Example |
|------|------------|---------|
| Local variables | camelCase | `requestCount`, `selectedPlan`, `upstreamResponse` |
| Constants (true constants) | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS`, `HTTP_STATUS_OK` |
| Configuration values | camelCase | `config.port`, `settings.logLevel` |
| Environment-derived | camelCase | `encryptionKey`, `configPath` |

**Do**:
```typescript
const requestCount = 0;
const MAX_RETRY_COUNT = 3;
const selectedPlan = planSelector.selectBest(model);
```

**Don't**:
```typescript
const RequestCount = 0;  // Don't use PascalCase for variables
const max_retry_count = 3;  // Don't use snake_case for constants
const x = planSelector.selectBest(model);  // Don't use single letters except in loops
```

### 2.2 Functions & Methods

| Type | Convention | Example |
|------|------------|---------|
| Regular functions | camelCase, verb-first | `calculateQuota`, `parseRequestBody`, `validateConfig` |
| Async functions | camelCase, verb-first | `fetchUpstreamResponse`, `loadConfiguration` |
| Boolean functions | is/has/should/can prefix | `isValidModel`, `hasRemainingQuota`, `shouldRetryRequest` |
| Event handlers | handle + EventName | `handleRequest`, `handleQuotaExhausted`, `handleProviderError` |
| Factory functions | create + Noun | `createPlanSelector`, `createQuotaManager` |

**Do**:
```typescript
function calculateRemainingQuota(plan: CodingPlan): number { ... }
async function forwardRequestToProvider(request: GatewayRequest): Promise<Response> { ... }
function hasRemainingQuota(plan: CodingPlan): boolean { ... }
```

**Don't**:
```typescript
function RemainingQuota(plan: CodingPlan) { ... }  // Don't use PascalCase
function get_quota(plan: CodingPlan) { ... }  // Don't use snake_case
function check(plan: CodingPlan) { ... }  // Don't use vague names
```

### 2.3 Classes, Types & Interfaces

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase, noun | `QuotaManager`, `PlanSelector`, `RequestRouter` |
| Interfaces | PascalCase, noun (no I prefix) | `CodingPlan`, `GatewayConfig`, `QuotaState` |
| Type aliases | PascalCase | `ModelIdentifier`, `ProviderResponse`, `QuotaPeriod` |
| Enums | PascalCase name, PascalCase values | `ErrorCode`, `QuotaStatus` |
| Generic type parameters | Single letter or descriptive | `T`, `TResponse`, `TConfig` |

**Do**:
```typescript
interface CodingPlan {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

class QuotaManager {
  private quotaStore: Map<string, QuotaState>;
  public getRemainingQuota(planId: string): number { ... }
}

type ModelIdentifier = string;

enum QuotaPeriod {
  Daily = 'daily',
  Monthly = 'monthly',
  Total = 'total',
}
```

**Don't**:
```typescript
interface ICodingPlan { ... }  // Don't use I prefix for interfaces
class quotaManager { ... }  // Don't use camelCase for classes
type model_identifier = string;  // Don't use snake_case for types
```

### 2.4 Modules & Imports

| Type | Convention | Example |
|------|------------|---------|
| Module names | kebab-case | `plan-selector`, `quota-manager`, `request-proxy` |
| Named imports | Preserve original name | `import { FastifyInstance } from 'fastify'` |
| Default imports | camelCase matching purpose | `import router from './router'` |
| Namespace imports | PascalCase | `import * as Crypto from 'crypto'` |
| Aliases | Use descriptive names | `import { selectBestPlan as selectPlan } from './selector'` |

**Import order**:
1. Node.js built-in modules
2. Third-party packages
3. Internal modules (use path aliases)

```typescript
// 1. Built-in
import { createHash, randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';

// 2. Third-party
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// 3. Internal
import { QuotaManager } from '@/services/quota-manager';
import { CodingPlan } from '@/types/coding-plan';
```

---

## 3. Files & Directories

### 3.1 File Naming

| Type | Convention | Example |
|------|------------|---------|
| TypeScript source | kebab-case.ts | `quota-manager.ts`, `plan-selector.ts` |
| Test files | kebab-case.test.ts | `quota-manager.test.ts` |
| Configuration files | kebab-case.ext or standard names | `tsconfig.json`, `.eslintrc.js`, `vitest.config.ts` |
| Type definition files | kebab-case.d.ts or types/index.ts | `env.d.ts`, `types/express.d.ts` |

### 3.2 Directory Structure

```
coding-plan-gateway/
├── src/
│   ├── index.ts                 # Application entry point
│   ├── app.ts                   # Fastify app factory
│   ├── config/
│   │   ├── index.ts             # Config loader/aggregator
│   │   ├── schema.ts            # Configuration schema
│   │   └── defaults.ts          # Default configuration values
│   ├── routes/
│   │   ├── index.ts             # Route registration
│   │   ├── openai/
│   │   │   ├── index.ts         # OpenAI endpoint routes
│   │   │   └── handlers.ts      # Request handlers
│   │   ├── anthropic/
│   │   │   ├── index.ts         # Anthropic endpoint routes
│   │   │   └── handlers.ts      # Request handlers
│   │   ├── admin/
│   │   │   ├── index.ts         # Admin/config routes
│   │   │   └── handlers.ts      # Config CRUD handlers
│   │   └── health/
│   │       └── index.ts         # Health check routes
│   ├── services/
│   │   ├── quota-manager.ts     # Quota tracking service
│   │   ├── plan-selector.ts     # Plan selection logic
│   │   ├── request-router.ts    # Request routing logic
│   │   └── request-proxy.ts     # Upstream proxy logic
│   ├── middleware/
│   │   ├── error-handler.ts     # Global error handling
│   │   ├── request-logger.ts    # Request logging
│   │   └── validation.ts        # Request validation
│   ├── types/
│   │   ├── coding-plan.ts       # CodingPlan interface
│   │   ├── gateway-request.ts   # Internal request types
│   │   ├── quota.ts             # Quota-related types
│   │   └── index.ts             # Type exports
│   └── utils/
│       ├── crypto.ts            # Encryption utilities
│       ├── validators.ts        # Validation helpers
│       └── logger.ts            # Logging utilities
├── tests/
│   ├── unit/
│   │   └── services/
│   │       ├── quota-manager.test.ts
│   │       └── plan-selector.test.ts
│   ├── integration/
│   │   └── routes/
│   │       └── openai.test.ts
│   └── fixtures/
│       └── mock-plans.ts        # Test data fixtures
├── docs/
│   ├── architecture.md          # Architecture documentation
│   └── standards.md             # This file
├── specs/                       # Feature specifications
├── memory/                      # Project memory/ground-rules
├── .editorconfig                # Editor configuration
├── .eslintrc.js                 # ESLint configuration
├── .prettierrc                  # Prettier configuration
├── tsconfig.json                # TypeScript configuration
├── vitest.config.ts             # Test configuration
├── package.json                 # Project manifest
└── Dockerfile                   # Container definition
```

### 3.3 Module Organization

- **Feature-based structure within layers**: Group related functionality (e.g., routes/openai contains all OpenAI-related code)
- **Single responsibility per file**: Each file has one primary export/class
- **Index files for public APIs**: Use `index.ts` to re-export public interfaces
- **Co-locate tests**: Tests mirror source structure in `tests/` directory

---

## 4. API Standards

### 4.1 REST Endpoint Naming

| Type | Convention | Example |
|------|------------|---------|
| Resource endpoints | Plural nouns, kebab-case | `/api/plans`, `/api/quota-usage` |
| Nested resources | Parent/child pattern | `/api/plans/:planId/models` |
| Actions (non-CRUD) | Verb as path segment | `/api/quota/:planId/reset` |
| OpenAI-compatible | Standard paths | `/v1/chat/completions`, `/v1/models` |
| Anthropic-compatible | Standard paths | `/v1/messages` |

**Do**:
```
GET    /api/plans                 # List all plans
GET    /api/plans/:id             # Get specific plan
POST   /api/plans                 # Create new plan
PUT    /api/plans/:id             # Update plan
DELETE /api/plans/:id             # Delete plan
POST   /api/quota/:planId/reset   # Reset quota for plan
GET    /v1/models                 # List available models
POST   /v1/chat/completions       # OpenAI chat endpoint
POST   /v1/messages               # Anthropic messages endpoint
```

**Don't**:
```
GET /api/getPlans              # Don't use verbs in GET paths
GET /api/plan                  # Don't use singular for collections
POST /plans                    # Don't omit /api prefix for admin routes
GET /v1/ChatCompletions        # Don't use PascalCase in URLs
```

### 4.2 HTTP Methods

| Method | Usage | Idempotent |
|--------|-------|------------|
| GET | Retrieve resource(s) | Yes |
| POST | Create resource or execute action | No |
| PUT | Full update/replace resource | Yes |
| PATCH | Partial update | No |
| DELETE | Remove resource | Yes |

### 4.3 Query Parameters

| Type | Convention | Example |
|------|------------|---------|
| Filtering | snake_case | `?model_name=claude`, `?is_active=true` |
| Pagination | snake_case | `?page=1&page_size=20` |
| Sorting | snake_case | `?sort_by=created_at&sort_order=desc` |

### 4.4 Request/Response Format

**Success Response**:
```typescript
// Single resource
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}

// Collection
{
  "data": [ ... ],
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601",
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100
    }
  }
}
```

**Error Response**:
```typescript
{
  "error": {
    "message": "Human-readable error message",
    "type": "error_type",
    "code": "ERROR_CODE",
    "details": { ... }  // Optional additional context
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  }
}
```

### 4.5 HTTP Status Codes

| Code | Usage |
|------|-------|
| 200 | Successful GET, PUT, PATCH |
| 201 | Successful POST (resource created) |
| 204 | Successful DELETE, no content |
| 400 | Validation error, malformed request |
| 401 | Authentication required |
| 403 | Permission denied |
| 404 | Resource not found |
| 409 | Conflict (duplicate, version mismatch) |
| 422 | Unprocessable entity (validation failed) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 502 | Upstream provider error |
| 503 | Service unavailable (no plans available) |

### 4.6 API Versioning

- **Current strategy**: URL path versioning (`/v1/...`)
- **Future**: Header-based versioning for finer control
- **Compatibility**: Maintain backward compatibility within major versions

---

## 5. Testing Standards

### 5.1 Test File Naming

| Type | Convention | Example |
|------|------------|---------|
| Unit tests | `*.test.ts` | `quota-manager.test.ts` |
| Integration tests | `*.integration.test.ts` | `routes.integration.test.ts` |
| E2E tests | `*.e2e.test.ts` | `gateway.e2e.test.ts` |
| Fixtures | `mock-{entity}.ts` or `fixture-{name}.ts` | `mock-plans.ts`, `fixture-config.ts` |

### 5.2 Test Structure (AAA Pattern)

```typescript
describe('QuotaManager', () => {
  describe('getRemainingQuota', () => {
    it('should return remaining quota when plan exists', () => {
      // Arrange
      const manager = new QuotaManager();
      const plan = createMockPlan({ quota: { limit: 100, used: 30 } });
      manager.registerPlan(plan);

      // Act
      const remaining = manager.getRemainingQuota(plan.id);

      // Assert
      expect(remaining).toBe(70);
    });

    it('should return 0 when quota is exhausted', () => {
      // ...
    });
  });
});
```

### 5.3 Test Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Standard behavior | `should {expected behavior} when {condition}` | `should return 404 when plan not found` |
| Error cases | `should throw {error} when {condition}` | `should throw ValidationError when config invalid` |
| Edge cases | `should handle {edge case} correctly` | `should handle empty model list correctly` |

### 5.4 Mock Naming

| Type | Convention | Example |
|------|------------|---------|
| Mock objects | `mock{Noun}` | `mockPlan`, `mockRequest`, `mockResponse` |
| Mock functions | `mock{Verb}` | `mockFetch`, `mockValidate` |
| Stub data | `stub{Noun}` or `fixture{Noun}` | `stubConfig`, `fixturePlans` |
| Spy functions | `{verb}Spy` | `fetchSpy`, `logSpy` |

### 5.5 Coverage Requirements

| Type | Minimum | Target |
|------|---------|--------|
| Line coverage | 80% | 90% |
| Branch coverage | 75% | 85% |
| Function coverage | 80% | 90% |

**Critical paths must have 100% coverage**:
- Request routing logic
- Quota tracking
- Configuration validation
- Error handling

---

## 6. Git Workflow

### 6.1 Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/{ticket-id}-{description}` | `feature/001-add-quota-tracking` |
| Bugfix | `bugfix/{ticket-id}-{description}` | `bugfix/002-fix-quota-calculation` |
| Hotfix | `hotfix/{ticket-id}-{description}` | `hotfix/003-fix-api-key-leak` |
| Release | `release/{version}` | `release/1.0.0` |
| Docs | `docs/{description}` | `docs/update-api-documentation` |
| Chore | `chore/{description}` | `chore/update-dependencies` |

### 6.2 Commit Message Format

Follow **Conventional Commits** specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types**:
| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change without feature/fix |
| `test` | Adding/modifying tests |
| `chore` | Build, config, dependencies |
| `perf` | Performance improvement |
| `style` | Formatting, no logic change |

**Examples**:
```
feat(quota): add quota tracking with persistence

- Implement QuotaManager service
- Add quota state persistence to file
- Support manual quota reset

Closes #001

---

fix(router): correct model matching for case sensitivity

The router was using exact match, causing 'Claude' to not match 'claude'.

Fixes #002

---

docs(api): update endpoint documentation with examples
```

### 6.3 Pull Request Format

```markdown
## Summary
Brief description of changes (1-3 sentences).

## Changes
- Change 1
- Change 2

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Checklist
- [ ] Follows coding standards
- [ ] No new warnings
- [ ] Documentation updated
- [ ] Breaking changes documented
```

---

## 7. Code Style Guide

### 7.1 Formatting Standards

| Element | Standard | Value |
|---------|----------|-------|
| Indentation | Spaces | 2 |
| Line length | Maximum | 100 characters |
| Semicolons | Required | Yes |
| Quotes | Single for strings, double for JSX | `'string'` |
| Trailing commas | ES5 compatible | Yes (multiline) |
| Brace style | K&R | Same line |

### 7.2 TypeScript Specific

| Element | Standard |
|---------|----------|
| Strict mode | Enabled (`strict: true`) |
| Null checks | Use `strictNullChecks` |
| Return types | Explicit for public functions |
| Type assertions | Prefer `as Type` over `<Type>` |
| Union types | Prefer over enums for simple cases |
| Any | Avoid; use `unknown` when type unknown |

**Do**:
```typescript
export function parseModel(model: string): ModelIdentifier | undefined {
  // Explicit return type for public function
  const normalized = model.toLowerCase().trim();
  return normalized || undefined;
}
```

### 7.3 Import Organization

```typescript
// 1. Node.js built-ins
import { readFile } from 'fs/promises';
import path from 'path';

// 2. Third-party packages
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

// 3. Internal modules (with path aliases)
import { QuotaManager } from '@/services/quota-manager';
import type { CodingPlan } from '@/types';

// 4. Types only imports
import type { RequestConfig } from '@/types/request';
```

### 7.4 Code Quality Thresholds

| Metric | Limit |
|--------|-------|
| Cyclomatic complexity | Max 10 per function |
| Function length | Max 50 lines |
| File length | Max 300 lines |
| Parameters per function | Max 4 (use object for more) |
| Nesting depth | Max 3 levels |

---

## 8. Security Standards

### 8.1 Input Validation

- Validate ALL inputs at system boundaries
- Use schema validation (Zod recommended)
- Sanitize before use, encode before output

```typescript
import { z } from 'zod';

const PlanSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.array(z.string()).min(1),
  quota: z.object({
    limit: z.number().positive(),
    period: z.enum(['daily', 'monthly', 'total']),
  }),
});
```

### 8.2 Secret Management

- API keys encrypted at rest (AES-256)
- Secrets via environment variables
- Never log secrets
- Never commit secrets to git

```typescript
// Do
const apiKey = process.env.PROVIDER_API_KEY;

// Don't
const apiKey = 'sk-abc123...';  // NEVER hardcode secrets
```

### 8.3 OWASP Top 10 Prevention

| Vulnerability | Mitigation |
|---------------|------------|
| Injection | Parameterized queries, input validation |
| Broken auth | N/A (single-user, local only) |
| Sensitive data exposure | Encrypt API keys at rest |
| XXE | Disable XML parsing if used |
| Broken access control | Validate all inputs |
| Security misconfiguration | Secure defaults, minimal exposure |
| XSS | Encode outputs, Content-Security-Policy |
| Insecure deserialization | Validate schemas strictly |
| Known vulnerabilities | Dependency scanning in CI |
| Insufficient logging | Structured logging with request IDs |

---

## 9. Enforcement & Tools

### 9.1 Linting (ESLint)

```javascript
// .eslintrc.js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};
```

### 9.2 Formatting (Prettier)

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### 9.3 Editor Configuration

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
indent_size = 2
indent_style = space
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

### 9.4 Pre-commit Hooks

Use `husky` + `lint-staged`:

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml}": ["prettier --write"]
  }
}
```

### 9.5 CI Checks

Required checks on all PRs:
- [ ] Lint passes
- [ ] Type check passes
- [ ] Tests pass
- [ ] Coverage threshold met
- [ ] Security audit passes
- [ ] Build succeeds

---

## Quick Reference Card

### Naming at a Glance

| Element | Convention | Example |
|---------|------------|---------|
| Functions | camelCase, verb-first | `calculateQuota` |
| Variables | camelCase | `requestCount` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Classes/Types | PascalCase | `QuotaManager` |
| Interfaces | PascalCase (no I prefix) | `CodingPlan` |
| Files | kebab-case.ts | `quota-manager.ts` |
| Test files | *.test.ts | `quota-manager.test.ts` |
| Endpoints | kebab-case, plural | `/api/plans` |

### Code Style

- **Indent**: 2 spaces
- **Line length**: 100 chars max
- **Semicolons**: Required
- **Quotes**: Single
- **Braces**: K&R (same line)

### Function Limits

| Metric | Max |
|--------|-----|
| Lines | 50 |
| Parameters | 4 |
| Cyclomatic complexity | 10 |
| Nesting depth | 3 |

### HTTP Status Codes

| Code | Use |
|------|-----|
| 200 | Success (GET, PUT, PATCH) |
| 201 | Created (POST) |
| 204 | No content (DELETE) |
| 400 | Bad request |
| 404 | Not found |
| 422 | Validation error |
| 500 | Server error |

### Git Conventions

**Branches**: `{type}/{id}-{description}`
- `feature/001-add-quota`
- `bugfix/002-fix-routing`

**Commits**: Conventional Commits
- `feat(quota): add tracking`
- `fix(router): correct model matching`
- `docs(api): update examples`

### Test Patterns

**Naming**: `should {behavior} when {condition}`
```typescript
it('should return 404 when plan not found', () => {
  // Arrange
  const manager = new QuotaManager();

  // Act
  const result = manager.getPlan('nonexistent');

  // Assert
  expect(result).toBeUndefined();
});
```

### Security Checklist

- [ ] Validate all inputs
- [ ] Encrypt API keys at rest
- [ ] Never log secrets
- [ ] Never commit credentials
- [ ] Use parameterized queries

### Coverage Minimums

| Type | Min |
|------|-----|
| Lines | 80% |
| Branches | 75% |
| Functions | 80% |

---

**Notes**

- This document guides all development work across ALL features
- Update standards as the project evolves
- When in doubt, prioritize readability and maintainability
- Reference architecture.md for technology decisions
- Reference ground-rules.md for project principles

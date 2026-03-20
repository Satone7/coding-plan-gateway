# Coding Standards: Coding Plan Gateway

**Version**: 1.0 | **Date**: 2026-03-20 | **Status**: Active

**Purpose**: A concise, high-signal standards guide for **AI agents** to ensure consistent, maintainable, and secure code.

---

## Table of Contents

1. Executive Summary
2. UI Naming (N/A - Backend Only)
3. Code Naming Conventions
4. Files & Directories
5. API Standards
6. Database Standards
7. Testing Standards
8. Git Workflow
9. Documentation Standards
10. Code Style Guide
11. Security Standards
12. Enforcement & Tools
13. Agent Checklist

---

## 1. Executive Summary

- **Stack**: Node.js 20+ LTS, Fastify 4.x, TypeScript 5.x, Vitest, Docker
- **Naming**: Functions/variables (camelCase), constants (SCREAMING_SNAKE_CASE), classes/types/interfaces (PascalCase), files (kebab-case.ts), endpoints (kebab-case)
- **Architecture**: Monolithic single-process API gateway with in-memory quota tracking and file-based configuration
- **Key Principle**: Maximize readability, simplicity, and long-term maintainability

---

## 2. UI Naming (N/A - Backend Only)

This is a **backend-only API service**. No frontend or UI layer exists.

If a UI is added in the future, create comprehensive UI naming conventions covering:
- Component naming (PascalCase)
- Props/attributes (camelCase)
- Event handlers (handle/on prefix patterns)
- State management naming
- CSS methodology
- Accessibility attributes

---

## 3. Code Naming Conventions

### 3.1 Variables

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

### 3.2 Functions & Methods

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

### 3.3 Classes, Types & Interfaces

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

### 3.4 Modules & Imports

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

## 4. Files & Directories

### 4.1 File Naming

| Type | Convention | Example |
|------|------------|---------|
| TypeScript source | kebab-case.ts | `quota-manager.ts`, `plan-selector.ts` |
| Test files | kebab-case.test.ts | `quota-manager.test.ts` |
| Configuration files | kebab-case.ext or standard names | `tsconfig.json`, `.eslintrc.js`, `vitest.config.ts` |
| Type definition files | kebab-case.d.ts or types/index.ts | `env.d.ts`, `types/express.d.ts` |

### 4.2 Directory Structure

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

### 4.3 Module Organization

- **Feature-based structure within layers**: Group related functionality (e.g., routes/openai contains all OpenAI-related code)
- **Single responsibility per file**: Each file has one primary export/class
- **Index files for public APIs**: Use `index.ts` to re-export public interfaces
- **Co-locate tests**: Tests mirror source structure in `tests/` directory

---

## 5. API Standards

### 5.1 REST Endpoint Naming

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

### 5.2 HTTP Methods

| Method | Usage | Idempotent |
|--------|-------|------------|
| GET | Retrieve resource(s) | Yes |
| POST | Create resource or execute action | No |
| PUT | Full update/replace resource | Yes |
| PATCH | Partial update | No |
| DELETE | Remove resource | Yes |

### 5.3 Query Parameters

| Type | Convention | Example |
|------|------------|---------|
| Filtering | snake_case | `?model_name=claude`, `?is_active=true` |
| Pagination | snake_case | `?page=1&page_size=20` |
| Sorting | snake_case | `?sort_by=created_at&sort_order=desc` |

### 5.4 Request/Response Format

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

### 5.5 HTTP Status Codes

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

### 5.6 API Versioning

- **Current strategy**: URL path versioning (`/v1/...`)
- **Future**: Header-based versioning for finer control
- **Compatibility**: Maintain backward compatibility within major versions

---

## 6. Database Standards

### 6.1 File-Based Configuration

This project uses YAML/JSON file storage rather than a traditional database.

**Config File Naming**:
- `config.yaml` or `config.json` - Main configuration
- `quota-state.json` - Persisted quota state

### 6.2 Configuration Schema

```yaml
# config.yaml
plans:
  - id: string (uuid)
    name: string
    baseUrl: string (url)
    apiKey: string (encrypted)
    models: string[]
    quota:
      limit: number
      used: number
      period: daily | monthly | total
    timeout: number (ms, optional)
```

### 6.3 Future Database Naming (if added)

If a database is added in the future:

| Element | Convention | Example |
|---------|------------|---------|
| Tables | Plural, snake_case | `coding_plans`, `quota_usage_logs` |
| Columns | snake_case | `plan_id`, `created_at`, `api_key_encrypted` |
| Primary keys | `id` | `id UUID PRIMARY KEY` |
| Foreign keys | `{table}_id` | `plan_id REFERENCES coding_plans(id)` |
| Indexes | `idx_{table}_{columns}` | `idx_quota_usage_plan_id` |
| Timestamps | `{action}_at` | `created_at`, `updated_at`, `deleted_at` |

---

## 7. Testing Standards

### 7.1 Test File Naming

| Type | Convention | Example |
|------|------------|---------|
| Unit tests | `*.test.ts` | `quota-manager.test.ts` |
| Integration tests | `*.integration.test.ts` | `routes.integration.test.ts` |
| E2E tests | `*.e2e.test.ts` | `gateway.e2e.test.ts` |
| Fixtures | `mock-{entity}.ts` or `fixture-{name}.ts` | `mock-plans.ts`, `fixture-config.ts` |

### 7.2 Test Structure (AAA Pattern)

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

### 7.3 Test Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Standard behavior | `should {expected behavior} when {condition}` | `should return 404 when plan not found` |
| Error cases | `should throw {error} when {condition}` | `should throw ValidationError when config invalid` |
| Edge cases | `should handle {edge case} correctly` | `should handle empty model list correctly` |

### 7.4 Mock Naming

| Type | Convention | Example |
|------|------------|---------|
| Mock objects | `mock{Noun}` | `mockPlan`, `mockRequest`, `mockResponse` |
| Mock functions | `mock{Verb}` | `mockFetch`, `mockValidate` |
| Stub data | `stub{Noun}` or `fixture{Noun}` | `stubConfig`, `fixturePlans` |
| Spy functions | `{verb}Spy` | `fetchSpy`, `logSpy` |

### 7.5 Coverage Requirements

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

## 8. Git Workflow

### 8.1 Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/{ticket-id}-{description}` | `feature/001-add-quota-tracking` |
| Bugfix | `bugfix/{ticket-id}-{description}` | `bugfix/002-fix-quota-calculation` |
| Hotfix | `hotfix/{ticket-id}-{description}` | `hotfix/003-fix-api-key-leak` |
| Release | `release/{version}` | `release/1.0.0` |
| Docs | `docs/{description}` | `docs/update-api-documentation` |
| Chore | `chore/{description}` | `chore/update-dependencies` |

### 8.2 Commit Message Format

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

### 8.3 Pull Request Format

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

## 9. Documentation Standards

### 9.1 Code Comments

| Type | When to Use | Style |
|------|-------------|-------|
| Inline comments | Complex logic explanation | `// Explain WHY, not WHAT` |
| TODO comments | Future work | `// TODO(username): Description` |
| FIXME comments | Known issues | `// FIXME: Description of issue` |

**Do**:
```typescript
// Use exponential backoff to avoid overwhelming the provider
// during recovery from rate limiting
const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
```

**Don't**:
```typescript
// Calculate delay
const delay = baseDelay * Math.pow(2, retryCount);
```

### 9.2 TSDoc/JSDoc

Use TSDoc for public APIs:

```typescript
/**
 * Selects the best coding plan for a given model based on quota availability.
 *
 * @param model - The model identifier to find a plan for
 * @param availablePlans - List of plans that support the model
 * @returns The plan with highest remaining quota, or undefined if none available
 *
 * @example
 * ```typescript
 * const plan = selectBestPlan('claude-sonnet-4-6', plans);
 * if (plan) {
 *   console.log(`Selected ${plan.name} with ${plan.quota.remaining} remaining`);
 * }
 * ```
 */
export function selectBestPlan(
  model: string,
  availablePlans: CodingPlan[]
): CodingPlan | undefined;
```

### 9.3 README Structure

1. Project name and description
2. Quick start (prerequisites, installation, run)
3. Configuration
4. API Reference
5. Development (setup, testing, linting)
6. Deployment
7. Contributing
8. License

---

## 10. Code Style Guide

### 10.1 Formatting Standards

| Element | Standard | Value |
|---------|----------|-------|
| Indentation | Spaces | 2 |
| Line length | Maximum | 100 characters |
| Semicolons | Required | Yes |
| Quotes | Single for strings, double for JSX | `'string'` |
| Trailing commas | ES5 compatible | Yes (multiline) |
| Brace style | K&R | Same line |

### 10.2 TypeScript Specific

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

### 10.3 Import Organization

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

### 10.4 Code Quality Thresholds

| Metric | Limit |
|--------|-------|
| Cyclomatic complexity | Max 10 per function |
| Function length | Max 50 lines |
| File length | Max 300 lines |
| Parameters per function | Max 4 (use object for more) |
| Nesting depth | Max 3 levels |

---

## 11. Security Standards

### 11.1 Input Validation

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

### 11.2 Secret Management

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

### 11.3 OWASP Top 10 Prevention

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

## 12. Enforcement & Tools

### 12.1 Linting (ESLint)

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

### 12.2 Formatting (Prettier)

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

### 12.3 Editor Configuration

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

### 12.4 Pre-commit Hooks

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

### 12.5 CI Checks

Required checks on all PRs:
- [ ] Lint passes
- [ ] Type check passes
- [ ] Tests pass
- [ ] Coverage threshold met
- [ ] Security audit passes
- [ ] Build succeeds

---

## 13. Agent Checklist

Before writing any code, verify:

- [ ] **Naming**: Functions/variables (camelCase), constants (SCREAMING_SNAKE_CASE), classes/types (PascalCase), files (kebab-case)
- [ ] **API**: Endpoints (kebab-case, plural nouns), params (snake_case), consistent response shapes
- [ ] **Files**: Test files adjacent or in `tests/`, one responsibility per file
- [ ] **Tests**: AAA pattern, descriptive names, mocks with clear naming
- [ ] **Git**: Conventional commits, feature branch naming
- [ ] **Security**: Validate inputs, encrypt secrets, no hardcoded credentials
- [ ] **Style**: 2-space indent, 100 char lines, explicit return types
- [ ] **Documentation**: TSDoc for public APIs, explain "why" in comments
- [ ] **Quality**: Max 50 lines per function, max 300 lines per file, cyclomatic complexity < 10

---

**Notes**

- This document guides all development work across ALL features
- Update standards as the project evolves
- When in doubt, prioritize readability and maintainability
- Reference architecture.md for technology decisions
- Reference ground-rules.md for project principles
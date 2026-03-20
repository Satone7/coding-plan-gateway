# Standards Quick Reference

**Version**: 1.0 | **Updated**: 2026-03-20

## Naming at a Glance

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

## Import Order

```typescript
// 1. Built-in
import { readFile } from 'fs/promises';

// 2. Third-party
import { FastifyInstance } from 'fastify';

// 3. Internal
import { QuotaManager } from '@/services/quota-manager';

// 4. Types
import type { CodingPlan } from '@/types';
```

## Code Style

- **Indent**: 2 spaces
- **Line length**: 100 chars max
- **Semicolons**: Required
- **Quotes**: Single
- **Braces**: K&R (same line)

## Function Limits

| Metric | Max |
|--------|-----|
| Lines | 50 |
| Parameters | 4 |
| Cyclomatic complexity | 10 |
| Nesting depth | 3 |

## HTTP Status Codes

| Code | Use |
|------|-----|
| 200 | Success (GET, PUT, PATCH) |
| 201 | Created (POST) |
| 204 | No content (DELETE) |
| 400 | Bad request |
| 404 | Not found |
| 422 | Validation error |
| 500 | Server error |

## Git Conventions

**Branches**: `{type}/{id}-{description}`
- `feature/001-add-quota`
- `bugfix/002-fix-routing`

**Commits**: Conventional Commits
- `feat(quota): add tracking`
- `fix(router): correct model matching`
- `docs(api): update examples`

## Test Patterns

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

## Security Checklist

- [ ] Validate all inputs
- [ ] Encrypt API keys at rest
- [ ] Never log secrets
- [ ] Never commit credentials
- [ ] Use parameterized queries

## Coverage Minimums

| Type | Min |
|------|-----|
| Lines | 80% |
| Branches | 75% |
| Functions | 80% |

## Quick Links

- Full standards: `docs/standards.md`
- Architecture: `docs/architecture.md`
- Ground-rules: `memory/ground-rules.md`
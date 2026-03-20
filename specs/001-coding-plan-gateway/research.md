# Research: Coding Plan Gateway

**Date**: 2026-03-20 | **Feature**: 001-coding-plan-gateway

## Research Summary

This document captures research findings and technology decisions for the Coding Plan Gateway, with consideration for future extensibility (database, multi-user, Web UI, TUI onboarding).

---

## 1. Runtime & Framework Selection

### Decision: Node.js 20+ LTS with Fastify 4.x

**Rationale**:
- Fastify provides 65k+ req/sec throughput, ideal for gateway/proxy workloads
- Built-in JSON schema validation reduces boilerplate
- Plugin architecture enables modular feature addition (future: auth, rate limiting)
- Native TypeScript support with excellent type inference
- Lower memory footprint than Express
- Hook system enables request/response transformation (required for API format conversion)

**Alternatives Considered**:
| Framework | Pros | Cons | Extensibility |
|-----------|------|------|---------------|
| Express | Largest ecosystem, familiar | Slower, no built-in validation | Good |
| NestJS | Built-in DI, decorators, modular | Overkill for current scope, steeper learning | Excellent |
| Hono | Ultra-fast, edge-compatible | Smaller ecosystem, less middleware | Good |
| Bun runtime | Faster startup, native APIs | Less mature, compatibility issues | Unknown |

**Future Extensibility**:
- Fastify plugins support adding Web UI routes alongside API routes
- Can add authentication middleware without restructuring
- Plugin system allows gradual feature addition

---

## 2. Language Selection

### Decision: TypeScript 5.x with strict mode

**Rationale**:
- Type safety catches errors at compile time
- Excellent IDE support (autocompletion, refactoring)
- Interface definitions serve as API contracts
- Enum types for status codes, error types
- Type-only exports reduce bundle size
- Decorators available for future metadata-driven features

**Configuration**:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**Future Extensibility**:
- Shared types can be extracted to separate package for monorepo
- Type definitions ready for code generation (OpenAPI → types)

---

## 3. Storage Strategy

### Current: File-Based (YAML/JSON)

**Rationale**:
- Single-user local deployment doesn't require database
- Human-readable, version-controllable configuration
- Simple backup/restore (copy file)
- Hot-reload support without database connections

**Implementation**:
```
config/
├── plans.yaml          # Coding plan configurations
├── quota-state.json    # Persisted quota state
└── secrets.enc         # Encrypted API keys
```

### Future: PostgreSQL with Migration Path

**Migration Strategy** (when multi-user/database needed):
1. Abstract storage behind `IConfigStore` interface
2. Implement `FileConfigStore` (current) and `PostgresConfigStore` (future)
3. Use dependency injection to swap implementations
4. Migration script: file → database

**Repository Pattern** (prepare now):
```typescript
interface IPlanRepository {
  findById(id: string): Promise<CodingPlan | null>;
  findAll(): Promise<CodingPlan[]>;
  save(plan: CodingPlan): Promise<void>;
  delete(id: string): Promise<void>;
}

// Current: FilePlanRepository
// Future: PostgresPlanRepository
```

---

## 4. Multi-User Architecture (Future-Ready)

### Decision: Prepare abstractions now, implement later

**Current Design Considerations**:
- Add `userId` field to all entities (nullable now, required later)
- Store data in user-scoped structure
- Authentication middleware placeholder

**Future Implementation**:
```
src/
├── auth/
│   ├── middleware.ts      # Auth middleware
│   ├── providers/
│   │   ├── api-key.ts     # API key auth
│   │   └── oauth.ts       # OAuth (future)
│   └── context.ts         # User context extraction
├── middleware/
│   └── auth.ts            # Auth wrapper
```

**Authentication Options**:
| Method | Use Case | Effort |
|--------|----------|--------|
| API Key | CLI/TUI tools | Low |
| JWT | Web UI | Medium |
| OAuth2 | Third-party integration | High |

---

## 5. Web UI Architecture (Future-Ready)

### Decision: Fastify + Static + SPA (when needed)

**Rationale**:
- Fastify can serve static files and API from same process
- No separate backend needed
- React/Vue/Svelte SPA can be built separately and served

**Future Structure**:
```
src/
├── routes/
│   ├── api/           # API routes (current)
│   └── web/           # Web UI routes (future)
├── web/               # Frontend source (future)
│   ├── components/
│   ├── pages/
│   └── styles/
└── static/            # Built frontend assets
```

**Technology Choice for UI** (future):
| Framework | Pros | Cons |
|-----------|------|------|
| React | Largest ecosystem, hiring | Heavier bundle |
| Vue 3 | Simpler, good for admin UIs | Smaller ecosystem |
| Svelte | Smallest bundle, simple | Smaller ecosystem |

**Recommendation**: Vue 3 for admin dashboard (simpler for single-developer, good for CRUD UIs)

---

## 6. TUI Onboarding (Future-Ready)

### Decision: Ink (React for CLI) or Clack

**Rationale**:
- Interactive prompts for initial setup
- Can run without external dependencies
- Same TypeScript codebase

**Future Implementation**:
```typescript
// src/cli/onboard.ts
import { text, select, confirm } from '@clack/prompts';

async function onboard() {
  const name = await text({ message: 'Enter plan name:' });
  const baseUrl = await text({ message: 'Enter API base URL:' });
  const apiKey = await text({ message: 'Enter API key:', type: 'password' });
  // ...
}
```

**Technology Options**:
| Library | Style | Bundle Size |
|---------|-------|-------------|
| @clack/prompts | Minimal, modern | ~10KB |
| Ink (React) | React-based | ~50KB |
| Enquirer | Classic prompts | ~15KB |

**Recommendation**: @clack/prompts (lightweight, modern, good UX)

---

## 7. Database Selection (Future)

### Decision: PostgreSQL (when needed)

**Rationale**:
- JSONB support for flexible model lists, metadata
- ACID compliance for quota tracking
- Row-level security for multi-tenancy
- Mature ecosystem, well-documented
- Works with TypeScript via Prisma/Drizzle

**ORM Options**:
| ORM | Pros | Cons |
|-----|------|------|
| Prisma | Type-safe, migrations, best DX | Heavier, build step |
| Drizzle | Lightweight, SQL-like, fast | Less abstraction |
| Kysely | Type-safe SQL, no magic | More verbose |

**Recommendation**: Drizzle ORM (lightweight, good for Node.js, TypeScript-first)

---

## 8. Testing Strategy

### Decision: Vitest + MSW + TestContainers

**Rationale**:
- Vitest: Fast, TypeScript-native, Jest-compatible API
- MSW (Mock Service Worker): Mock upstream providers
- TestContainers (future): Real database for integration tests

**Test Categories**:
| Type | Tool | Coverage Target |
|------|------|-----------------|
| Unit | Vitest | 80% |
| Integration | Vitest + MSW | Key flows |
| E2E | Vitest + real providers | API compatibility |

---

## 9. Security Considerations

### Current Implementation:
- AES-256-GCM for API key encryption at rest
- TLS for upstream connections
- Input validation via JSON Schema
- Rate limiting (future)

### Future Additions:
- Authentication middleware
- RBAC for multi-user
- Audit logging
- API key rotation support

---

## 10. Extensibility Patterns

### Plugin Architecture (Future-Ready):
```typescript
interface IGatewayPlugin {
  name: string;
  version: string;
  init(app: FastifyInstance): Promise<void>;
  onRequest?(request: FastifyRequest): Promise<void>;
  onResponse?(response: FastifyReply): Promise<void>;
}

// Future plugins:
// - RateLimitPlugin
// - AuditLogPlugin
// - MetricsPlugin
// - WebUIPlugin
```

### Event System (Future-Ready):
```typescript
// Define events for extensibility
type GatewayEvent =
  | { type: 'request.routed'; planId: string; model: string }
  | { type: 'quota.updated'; planId: string; used: number; limit: number }
  | { type: 'plan.failed'; planId: string; error: Error };

// Allow plugins to subscribe
eventBus.on('quota.updated', async (event) => {
  // Future: persist to database
  // Future: send webhook
  // Future: update metrics
});
```

---

## Summary: Technology Stack

| Layer | Current | Future | Migration Path |
|-------|---------|--------|----------------|
| Runtime | Node.js 20+ | Same | N/A |
| Framework | Fastify 4.x | Same + plugins | Add plugins as needed |
| Language | TypeScript 5.x strict | Same | N/A |
| Storage | YAML/JSON files | PostgreSQL | Repository pattern |
| Auth | None | API Key / JWT | Middleware wrapper |
| UI | None | Vue 3 SPA | Static file serving |
| TUI | None | @clack/prompts | New CLI module |
| Testing | Vitest + MSW | + TestContainers | Add container tests |
| ORM | None | Drizzle | Add when DB needed |

---

## Architecture Alignment

This design aligns with `docs/architecture.md`:
- ADR-001: Monolithic single-process (maintained)
- ADR-002: File-based config (maintained, abstracted for future)
- ADR-003: In-memory quota with persistence (maintained)
- ADR-004: Dual API format support (maintained)
- ADR-005: Quota-based load balancing (maintained)

**New ADRs needed for future**:
- ADR-006: Repository Pattern for Storage Abstraction
- ADR-007: Plugin Architecture for Extensibility
- ADR-008: Event Bus for Cross-cutting Concerns
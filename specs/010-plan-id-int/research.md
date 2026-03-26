# Research: Plan ID Integer Optimization

**Branch**: `010-plan-id-int` | **Date**: 2026-03-26

## Research Summary

This feature is entirely within the existing codebase with no external dependencies or unknowns requiring research. All technical decisions are straightforward applications of existing patterns.

## Decisions

### 1. ID Type Selection

**Decision**: Use JavaScript `number` type (IEEE 754 double-precision float)

**Rationale**:
- JavaScript safe integer range: 2^53-1 (9,007,199,254,740,991) is more than sufficient
- Native JSON serialization support
- No additional dependencies required
- Consistent with existing TypeScript/JavaScript patterns in the codebase

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| `bigint` | Requires custom JSON serialization, overkill for expected scale |
| String integers | Adds complexity, loses numeric benefits (comparison, sorting) |
| External ID generator | Adds unnecessary dependency |

### 2. Counter Persistence Strategy

**Decision**: Store in separate `plan-id-counter.json` file

**Rationale**:
- Consistent with existing file-based storage pattern (config.yaml, quota-state.json)
- Single source of truth for highest assigned ID
- Atomic write on each ID assignment prevents collision
- Simple to backup and restore

**Alternatives Considered**:
| Alternative | Rejected Because |
|-------------|------------------|
| Embed in config.yaml | Mixing concerns, harder to manage atomically |
| In-memory only | Lost on restart, risk of ID collision |
| SQLite | Overkill for single-user local deployment |

### 3. Migration Strategy

**Decision**: Automatic migration on startup with backup

**Rationale**:
- Zero-touch upgrade for existing users
- UUID-to-integer mapping logged for audit
- Original config backed up before modification
- Idempotent - safe to run multiple times

**Migration Flow**:
1. Detect UUID-format IDs in config
2. Create backup of config and quota-state files
3. Assign sequential integers (1, 2, 3...)
4. Update quota-state.json with new IDs
5. Log UUID→int mapping
6. Set `migrationComplete` flag to prevent re-run

### 4. Atomic ID Assignment

**Decision**: Synchronous file write with locking

**Rationale**:
- Single-user deployment means minimal concurrency
- Node.js is single-threaded, so in-memory operations are atomic
- File write provides durability
- Simple to implement, no external dependencies

**Implementation**:
```typescript
// Atomic increment and return
async getNextId(): Promise<number> {
  this.counter++;
  await this.persist();
  return this.counter;
}
```

### 5. Validation Schema

**Decision**: Zod schema with positive integer constraint

**Rationale**:
- Consistent with existing validation patterns (see `src/utils/validators.ts`)
- Clear error messages for invalid input
- Type-safe validation

**Schema**:
```typescript
const planIdSchema = z.number().int().positive().max(MAX_SAFE_INTEGER);
```

## Architecture Alignment

This design aligns with existing architecture decisions:

| ADR | Alignment |
|-----|-----------|
| ADR-001: Monolithic Single-Process | ID counter is in-process, no distributed coordination needed |
| ADR-002: File-Based Configuration | Counter stored as JSON file, consistent pattern |
| ADR-003: In-Memory Quota with Persistence | Same pattern used for ID counter |

## No NEEDS CLARIFICATION Items

All technical context was clear from existing codebase analysis:
- Existing `CodingPlan` interface uses `id: string` (line 53, src/types/coding-plan.ts)
- Existing validators use Zod schemas
- Existing storage pattern uses JSON files
- No external API changes required (IDs already exposed in API paths)
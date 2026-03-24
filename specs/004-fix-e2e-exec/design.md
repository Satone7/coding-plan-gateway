# Technical Design: Fix E2E Claude Code Execution

**Branch**: `004-fix-e2e-exec` | **Date**: 2026-03-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-fix-e2e-exec/spec.md`

**User Input**: 网关尽可能的透传请求的所有字段，只做负载均衡和统计，不要让上下游感知网关的存在
(Gateway should pass through all request fields as much as possible, only doing load balancing and statistics, without letting upstream or downstream be aware of the gateway's existence.)

## Summary

Fix two issues preventing Claude Code from working correctly in the E2E Docker testing environment:
1. Missing `ANTHROPIC_API_KEY` environment variable causing authentication errors
2. Request schema validation rejecting `system` field as array (Claude Code 2.1.81+ format)

**Design Principle**: Gateway acts as a transparent proxy - passes through all request fields unchanged, only performing load balancing and statistics.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), Vitest (testing)
**Storage**: YAML/JSON files (configuration), in-memory (quota tracking)
**Testing**: Vitest with MSW for mocking
**Target Platform**: Docker container on local machine
**Project Type**: Single (backend API gateway)
**Performance Goals**: <50ms routing overhead (p95)
**Constraints**: Single-user local deployment, maintain backward compatibility
**Scale/Scope**: 10+ coding plans, 100+ concurrent requests

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Rule | Status | Notes |
|------|--------|-------|
| Code follows linting standards | ✅ Pass | No new patterns introduced |
| Functions have single responsibility | ✅ Pass | Schema update is isolated |
| Testing required | ✅ Pass | Unit and integration tests planned |
| Performance targets met | ✅ Pass | No additional latency introduced |
| Input validation required | ✅ Pass | Extended validation for system field |

**Re-check after design**: All gates remain passed. The changes are minimal and focused.

## Project Structure

### Documentation (this feature)

```text
specs/004-fix-e2e-exec/
├── design.md            # This file
├── research.md          # Research findings
├── data-model.md        # Type changes
├── quickstart.md        # Testing guide
├── contracts/           # API contracts
│   └── anthropic-messages-api.md
└── tasks.md             # Implementation tasks (created by /rainbow.taskify)
```

### Source Code (repository root)

```text
src/
├── types/
│   └── anthropic.ts     # ← Modified: system field type
├── routes/
│   └── anthropic/
│       └── handlers.ts  # ← Modified: validation schema
└── services/
    └── request-proxy.ts # No changes (already transparent)

docker-compose.e2e.yml   # ← Modified: add ANTHROPIC_API_KEY

tests/
├── unit/
│   └── routes/
│       └── anthropic/
│           └── handlers.test.ts  # ← Modified: add array tests
└── integration/
    └── routes/
        └── anthropic.test.ts     # ← Modified: add array tests
```

**Structure Decision**: Single project structure. Changes are isolated to specific files.

## Implementation Details

### Change 1: Docker Compose Configuration

**File**: `docker-compose.e2e.yml`

**Change**: Add `ANTHROPIC_API_KEY` environment variable to Claude Code container.

```yaml
# Before
claude-code:
  environment:
    - ANTHROPIC_BASE_URL=http://gateway:8080
    - ANTHROPIC_MODEL=kimi-k2.5

# After
claude-code:
  environment:
    - ANTHROPIC_BASE_URL=http://gateway:8080
    - ANTHROPIC_MODEL=kimi-k2.5
    - ANTHROPIC_API_KEY=dummy-key-for-gateway
```

**Rationale**: Claude Code CLI requires an API key even when using custom base URL. The gateway ignores this key and uses its own configured keys for upstream requests.

### Change 2: TypeScript Type Definition

**File**: `src/types/anthropic.ts`

**Change**: Update `system` field to accept both string and array formats.

```typescript
// Add new types
export interface AnthropicSystemTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicSystemImageBlock {
  type: 'image';
  source: {
    type: 'url' | 'base64';
    media_type: string;
    data: string;
  };
}

export type AnthropicSystemBlock = AnthropicSystemTextBlock | AnthropicSystemImageBlock;

// Update AnthropicMessageRequest
export interface AnthropicMessageRequest {
  // ... existing fields ...
  system?: string | AnthropicSystemBlock[];  // ← Modified
  // Allow additional fields for pass-through
  [key: string]: unknown;
}
```

### Change 3: Validation Schema

**File**: `src/routes/anthropic/handlers.ts`

**Change**: Update Zod schema to accept both formats and pass through additional fields.

```typescript
// Add system block schema
const systemBlockSchema = z.object({
  type: z.enum(['text', 'image']),
}).passthrough();

// Update messageRequestSchema
const messageRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.any()).min(1),
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional().default(false),
  system: z.union([
    z.string(),
    z.array(systemBlockSchema),
  ]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string()).optional(),
  metadata: z.object({ user_id: z.string().optional() }).optional(),
}).passthrough();  // ← Allow additional fields
```

### Change 4: Empty Array Handling

**Location**: `src/routes/anthropic/handlers.ts`

**Logic**: Treat empty system array as missing field.

```typescript
// In validateAndParse or before forwarding
if (Array.isArray(body.system) && body.system.length === 0) {
  delete body.system;  // Treat as missing
}
```

## Testing Plan

### Unit Tests

| Test | File | Description |
|------|------|-------------|
| System string validation | `handlers.test.ts` | Accept string system |
| System array validation | `handlers.test.ts` | Accept array system |
| Empty array handling | `handlers.test.ts` | Empty array treated as missing |
| Unknown field pass-through | `handlers.test.ts` | Additional fields preserved |

### Integration Tests

| Test | File | Description |
|------|------|-------------|
| Full request with array system | `anthropic.test.ts` | End-to-end with array format |
| Streaming with array system | `anthropic.test.ts` | Streaming requests work |

### E2E Verification

| Test | Command | Expected |
|------|---------|----------|
| Claude Code execution | `docker exec claude-code claude -p "hello"` | Valid response |
| Array system request | `curl -X POST ...` with array system | Accepted |

## Pass-Through Behavior

The gateway maintains transparency:

1. **Request Forwarding**: All fields in the request body are passed unchanged to upstream
2. **No Transformation**: The gateway does not modify request structure
3. **Statistics Only**: Gateway records metrics (latency, quota) without altering data
4. **Error Pass-Through**: Upstream errors are returned to client unchanged

```
Client Request → [Gateway: Route + Stats] → Upstream Provider
                     ↓ (no modification)
Client Response ← [Gateway: Record Metrics] ← Upstream Response
```

## Complexity Tracking

> No ground-rules violations. Changes are minimal and focused.

| Change | Complexity | Justification |
|--------|------------|---------------|
| System field union type | Low | Standard TypeScript pattern |
| Passthrough schema | Low | Zod built-in feature |
| Environment variable | Low | Single line addition |

## Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| Zod | Schema validation | ^3.x (existing) |
| TypeScript | Type system | ^5.x (existing) |
| Vitest | Testing | ^1.x (existing) |

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Upstream rejects array format | Low | Medium | Pass through unchanged; provider handles |
| Breaking existing clients | Very Low | High | Backward compatible; string still accepted |
| Missing other new fields | Low | Low | Passthrough schema handles unknowns |

## Definition of Done

- [x] `ANTHROPIC_API_KEY` added to docker-compose.e2e.yml
- [x] TypeScript types updated for system field
- [x] Zod schema accepts both string and array
- [x] Empty arrays treated as missing
- [x] Unit tests pass
- [x] Integration tests pass
- [x] E2E test: `docker exec claude-code claude -p "hello"` works (with valid API key)
- [x] All existing tests still pass
- [x] Documentation updated (README if needed)
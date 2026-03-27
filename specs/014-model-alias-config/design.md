# Technical Design: Model Alias Configuration

**Branch**: `014-model-alias-config` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/014-model-alias-config/spec.md`

**Note**: This template is filled in by the `/rainbow.design` command.

## Summary

Move model alias settings from hardcoded constants to configuration file. Add `modelAliases` as a top-level configuration key in config.yaml, replacing the existing hardcoded MODEL_ALIASES in model-resolver.ts. Support circular alias validation at startup and maintain hot-reload capability.

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, Zod (validation), yaml (for config parsing)
**Storage**: YAML file (config.yaml) - existing file-based configuration
**Testing**: Vitest (existing project test framework)
**Target Platform**: Linux server (Node.js)
**Project Type**: Single backend service (existing monolithic architecture)
**Performance Goals**: <50ms routing overhead (p95) - unchanged from existing architecture
**Constraints**: Backward compatible - existing configs without modelAliases work unchanged
**Scale/Scope**: Single-user local deployment, 10+ coding plans support

## Ground-rules Check

| Gate | Status | Notes |
|------|--------|-------|
| All code MUST follow linting/formatting standards | PASS | Using existing ESLint/Prettier |
| Functions MUST have single responsibility | PASS | ModelResolver already follows this |
| Naming MUST be descriptive and consistent | PASS | Using existing naming conventions |
| Complexity MUST be justified | PASS | Simple config-based approach |
| Dead code MUST be removed | PASS | Hardcoded MODEL_ALIASES will be removed |
| Tests MUST be independent/isolated | PASS | Will use existing test patterns |

**GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.**

*Initial check passed - no violations found.*

## Project Structure

### Documentation (this feature)

```text
specs/014-model-alias-config/
├── design.md            # This file
├── spec.md              # Feature specification
├── research.md          # Not needed - all clarifications resolved
├── data-model.md        # Phase 1: Data model for config
├── quickstart.md        # Phase 1: Usage guide
├── contracts/           # Phase 1: API contracts (if needed)
└── tasks.md             # Phase 2: Implementation tasks
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── index.ts         # Existing config loader (modify)
│   ├── schema.ts        # Existing schema (add modelAliases)
│   └── defaults.ts      # Existing defaults
├── services/
│   └── model-resolver.ts  # Modify: accept config-based aliases
├── routes/
│   └── admin/
│       └── index.ts     # Optional: add alias viewing endpoint
tests/
├── unit/
│   └── services/
│       └── model-resolver.test.ts  # Update existing tests
```

**Structure Decision**: Single project - modify existing files in src/config/ and src/services/ to add modelAliases support. No new directories or significant restructuring required.

## Complexity Tracking

> **Fill ONLY if Ground-rules Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| None | - | - |

---

# Phase 1: Design

## Data Model

### Configuration Schema Changes

```typescript
// New: modelAliases configuration
const modelAliasesSchema = z.record(
  z.string().min(1),  // alias key
  z.string().min(1)   // canonical model name
).default({});

// Add to configSchema
export const configSchema = z.object({
  version: z.string().optional(),
  plans: z.array(planConfigSchema).default([]),
  loadBalancing: loadBalanceConfigSchema.optional(),
  modelAliases: modelAliasesSchema,  // NEW
});
```

### Config File Format

```yaml
# config.yaml (example)
version: "1.0"

# Model aliases configuration (NEW)
modelAliases:
  # GPT aliases
  gpt-4: gpt-4-turbo
  gpt-4-32k: gpt-4-32k-context
  gpt-3.5-turbo: gpt-3.5-turbo-0125

  # Claude aliases
  claude-3: claude-3-opus-20240229
  claude-3-sonnet: claude-3-sonnet-20240229
  claude-3-haiku: claude-3-haiku-20240307

  # MiniMax aliases
  minimax-m2.5: MiniMax-M2.5
  minimax-m2: MiniMax-M2

plans:
  - id: 1
    name: "Ark Coding Plan"
    # ... existing plan config
```

### Data Flow

```
config.yaml → loadConfig() → configSchema.parse()
                                      ↓
                              Config { modelAliases }
                                      ↓
                              ModelResolver(aliases)
                                      ↓
                              Request routing uses aliases
```

## Component Changes

### 1. Config Schema (src/config/schema.ts)

- Add `modelAliasesSchema` - Zod schema for alias map
- Add `modelAliases` field to `configSchema`
- Update `Config` type to include modelAliases

### 2. Config Loader (src/config/index.ts)

- Pass modelAliases to ModelResolver during initialization
- Support hot-reload of aliases (existing reload mechanism)

### 3. Model Resolver (src/services/model-resolver.ts)

- Remove hardcoded MODEL_ALIASES constant
- Accept aliases as constructor/config parameter
- Add circular alias detection at initialization
- Fall back to empty alias map if not configured (backward compat)

### 4. Tests (tests/unit/services/model-resolver.test.ts)

- Update tests to use config-based aliases
- Add tests for circular alias detection
- Add tests for backward compatibility

## Edge Cases

1. **Empty config**: If modelAliases not present, use empty map (existing behavior with no aliases)
2. **Invalid format**: Log warning, use empty map
3. **Circular aliases**: Fail at startup with clear error message
4. **Self-referencing alias**: Fail at startup (e.g., "a: a")
5. **Case sensitivity**: Alias keys are case-insensitive (normalized to lowercase)

## API Contracts

No new API endpoints required for this feature. Existing `/v1/chat/completions` and `/v1/messages` endpoints will automatically use configured aliases for model resolution.

Optional future enhancement: Add `/api/config/model-aliases` endpoint to view current aliases (out of scope).

## Implementation Notes

1. **Backward Compatibility**: If config.yaml doesn't have modelAliases, the system should work exactly as before (no aliases)
2. **Hot Reload**: Existing reload mechanism already handles config changes - will automatically apply to modelAliases
3. **Logging**: Use existing logger.debug() for alias resolution (as per clarification)
4. **Validation**: Validate for circular references at startup before accepting configuration

## Ground-rules Re-check

| Gate | Status | Notes |
|------|--------|-------|
| All code MUST follow linting/formatting standards | PASS | Using existing ESLint/Prettier |
| Functions MUST have single responsibility | PASS | Each function has one purpose |
| Naming MUST be descriptive and consistent | PASS | Following project conventions |
| Complexity MUST be justified | PASS | Simple, linear change |
| Dead code MUST be removed | PASS | Hardcoded aliases removed |
| Tests MUST be independent/isolated | PASS | Will follow existing patterns |

**Post-design check passed.**

---

## Next Steps

Run `/rainbow.taskify` to generate implementation tasks from this design.
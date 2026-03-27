# Technical Design: Model Name Case-Insensitive Matching

**Branch**: `013-model-name-normalization` | **Date**: 2026-03-27 | **Spec**: spec.md
**Input**: Feature specification from `specs/013-model-name-normalization/spec.md`

**Note**: This template is filled in by the `/rainbow.design` command.

## Summary

Enable case-insensitive model name matching and alias support for request routing. The core case-insensitive matching already exists in the codebase; the primary enhancement is adding model alias support (FR-006) and improving error messages to list available models (FR-004).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Node.js 20+ LTS
**Primary Dependencies**: Fastify 4.x, existing plan-selector and plan-repository services
**Storage**: In-memory (no persistence required - aliases are constant)
**Testing**: Vitest
**Target Platform**: Linux server (Docker or local)
**Project Type**: Single monolithic backend service
**Performance Goals**: <50ms routing overhead (p95) - maintain existing performance
**Constraints**:
- Must preserve backward compatibility with existing plan configurations
- Must forward original model names to upstream providers (not normalized)
- No new external dependencies
**Scale/Scope**: Single-user local deployment, 10+ coding plans

## Ground-rules Check

| Ground Rule | Status | Notes |
|-------------|--------|-------|
| Code Quality: Single responsibility | PASS | New ModelResolver handles only model normalization |
| Code Quality: Naming consistency | PASS | camelCase for functions, PascalCase for classes |
| Testing: Include tests | PASS | Unit tests for alias resolution |
| Performance: <50ms p95 | PASS | O(n) alias lookup, cached plans |
| Security: Input validation | PASS | Validate model names at boundaries |

## Project Structure

### Documentation (this feature)

```
specs/013-model-name-normalization/
├── design.md            # This file (/rainbow.design command output)
├── research.md          # Phase 0 output (/rainbow.design command)
├── data-model.md        # Phase 1 output (/rainbow.design command)
├── quickstart.md        # Phase 1 output (/rainbow.design command)
├── contracts/           # Phase 1 output (/rainbow.design command)
└── tasks.md             # Phase 2 output (/rainbow.taskify command - NOT created by /rainbow.design)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── model-resolver.ts    # NEW: Model normalization and alias resolution
│   ├── plan-selector.ts    # EXISTING: Already has case-insensitive matching
│   └── plan-repository.ts  # EXISTING: Already has case-insensitive matching
└── ...

tests/
├── unit/
│   ├── model-resolver.test.ts  # NEW: Test alias resolution
│   └── ...
```

**Structure Decision**: Add new `model-resolver.ts` service for alias management. Extend existing `plan-selector.ts` and `request-router.ts` to use model resolver. No new directories required - feature integrates into existing service layer.

## Complexity Tracking

> **Fill ONLY if Ground-rules Check has violations that must be justified**

No complexity violations. The implementation extends existing services rather than creating new architectural patterns.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| ----------- | ------------ |-------------------------------------|
| None | N/A | N/A |

## Key Implementation Points

1. **Existing case-insensitive matching**: Already implemented in `PlanRepository.findByModel()` and `PlanSelector.findPlansByModel()` using `toLowerCase()` comparison.

2. **New alias resolution**: Add `ModelResolver` service that:
   - Maintains built-in alias map
   - Resolves alias to canonical model name
   - Returns original model name for upstream requests

3. **Error message improvement**: Enhance error message in `RequestRouter.getPlanForRequest()` to include available models when no match found.

4. **Backward compatibility**: All existing plan configurations work without modification.

## Data Flow

```
1. Incoming request with model name (e.g., "gpt-4")
2. ModelResolver.resolve(model) ->
   a. Normalize to lowercase: "gpt-4"
   b. Check alias map: "gpt-4" -> "gpt-4-turbo"
   c. Return canonical name for matching: "gpt-4-turbo"
3. PlanSelector finds plans with model (case-insensitive): "gpt-4-turbo"
4. RequestRouter selects best plan
5. RequestProxy forwards ORIGINAL model name from request: "gpt-4"
```
# Research: Fix E2E Claude Code Execution

**Feature**: 004-fix-e2e-exec
**Date**: 2026-03-24

## Research Summary

This feature requires minimal research as the issues are well-defined from actual investigation in the e2e environment.

## Issue 1: Claude Code Authentication

### Decision
Add `ANTHROPIC_API_KEY` environment variable to the Claude Code container in docker-compose.e2e.yml.

### Rationale
Claude Code CLI requires an API key to be set even when using a custom base URL. Without it, the CLI shows "Not logged in · Please run /login" error. The gateway does not validate this key - it uses its own configured API keys for upstream requests.

### Alternatives Considered
1. **OAuth login flow**: Not suitable for automated/containerized environments
2. **Keychain integration**: Requires interactive setup, not suitable for Docker
3. **Skip authentication flag**: Claude Code does not support this

### Architecture Alignment
Per ADR-004 (Dual API Format Support), the gateway provides seamless integration with AI tools. The placeholder API key approach maintains this seamless integration without requiring manual login steps.

## Issue 2: System Field Schema Validation

### Decision
Update the Zod validation schema to accept `system` as either a string or an array of content blocks, then pass through the entire request body unchanged to the upstream provider.

### Rationale
- Anthropic API specification allows `system` as string OR array of content blocks
- Claude Code 2.1.81+ sends `system` as an array
- The gateway's current validation only accepts string, causing validation errors
- User requirement: "网关尽可能的透传请求的所有字段" (gateway should pass through all request fields as much as possible)

### Alternatives Considered
1. **Convert array to string**: Would lose formatting and image blocks, breaks transparency
2. **Provider-aware conversion**: Adds complexity, not needed if upstream accepts array format
3. **Reject array format**: Would block newer Claude Code versions

### Architecture Alignment
- Per ADR-004, the gateway provides maximum tool compatibility
- Per architecture.md Section 6.1 Performance: "Minimal request transformation"
- User clarification: Pass through unchanged, only do load balancing and statistics

## Implementation Approach

### Type System Changes
Update TypeScript interfaces in `src/types/anthropic.ts`:
- `system` field: `string | AnthropicSystemContentBlock[]`
- Add `AnthropicSystemContentBlock` type for array content

### Validation Changes
Update Zod schema in `src/routes/anthropic/handlers.ts`:
- Use `z.union()` or `z.any()` for system field
- Accept any valid shape and pass through

### Docker Configuration
Update `docker-compose.e2e.yml`:
- Add `ANTHROPIC_API_KEY=dummy-key-for-gateway` environment variable

## Testing Strategy

1. **Unit tests**: Test schema accepts both string and array formats
2. **Integration tests**: Verify requests with array system field are forwarded correctly
3. **E2E tests**: Run `docker exec claude-code claude -p hello` and verify success

## Risks

| Risk | Mitigation |
|------|------------|
| Upstream provider rejects array format | Pass through unchanged; provider handles validation |
| Missing other fields in validation | Use `z.any()` for unknown fields to maintain transparency |
| Breaking existing tests | All existing tests should pass; add new tests for array format |
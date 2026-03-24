# Research: API Key Management

**Feature**: 005-api-key-management
**Date**: 2026-03-24

## Research Questions

### R1: API Key Generation Best Practices

**Decision**: Use prefixed random strings with 32 alphanumeric characters.

**Rationale**:
- Prefix (`cpg_`) allows easy identification of key source
- 32 chars base62 provides ~192 bits of entropy, cryptographically secure
- Standard pattern used by Stripe, GitHub, and other API providers

**Alternatives Considered**:
- UUID format: Not human-readable, no prefix identification
- Simple random hex: Less compact, harder to copy/paste

**Architecture Alignment**: Follows ADR-003 (in-memory with persistence) for key validation speed.

---

### R2: Key Hashing Algorithm

**Decision**: bcrypt with cost factor 12.

**Rationale**:
- bcrypt is purpose-built for password/key hashing
- Cost factor 12 provides ~250ms hashing time, acceptable for CLI operations
- Built-in salt eliminates need for separate salt storage
- Industry standard, well-tested implementation

**Alternatives Considered**:
- Argon2: More modern but requires additional dependency
- SHA-256: Not designed for key hashing, vulnerable to brute force
- AES encryption: Reversible, not appropriate for authentication

**Architecture Alignment**: Uses existing crypto utilities in `src/utils/crypto.ts` for consistency.

---

### R3: Usage Data Storage Format

**Decision**: Daily-aggregated JSON file with nested structure.

**Rationale**:
- Daily aggregation provides reasonable granularity for reporting
- JSON is human-readable and easily debuggable
- File-based storage consistent with existing architecture (ADR-002)
- Simple to backup and restore

**Alternatives Considered**:
- Per-request records: Too granular, file size grows too quickly
- SQLite: Adds database dependency, violates ADR-002
- In-memory only: Data loss on restart

**Structure**:
```json
{
  "version": "1.0",
  "lastSync": "2026-03-24T10:30:00Z",
  "usage": {
    "2026-03-24": {
      "key-uuid-1": {
        "requestCount": 150,
        "inputTokens": 45000,
        "outputTokens": 12000,
        "lastRequest": "2026-03-24T10:25:00Z"
      }
    }
  }
}
```

---

### R4: Authentication Middleware Pattern

**Decision**: Fastify hook-based authentication with exemption list.

**Rationale**:
- Fastify hooks allow request interception before route handlers
- Consistent with existing middleware pattern (`request-logger.ts`, `error-handler.ts`)
- Exemption list allows flexibility for health checks and public endpoints
- Performance: Hook runs only once per request

**Implementation**:
```typescript
// Using preHandler hook for auth validation
app.addHook('preHandler', async (request, reply) => {
  if (isExemptPath(request.url)) return;
  await validateApiKey(request, reply);
});
```

**Architecture Alignment**: Consistent with existing middleware patterns in `src/middleware/`.

---

### R5: CLI Implementation Approach

**Decision**: Separate CLI entry point using Node.js scripts with commander-style argument parsing.

**Rationale**:
- Minimal dependency addition (use built-in `process.argv` parsing or minimist)
- Scripts can run independently of server process
- Consistent with existing npm script patterns
- Allows key management when server is not running

**Alternatives Considered**:
- REPL-based CLI: Requires running server
- HTTP API only: Requires server running for key management
- Interactive prompts: Not scriptable, harder to automate

**Architecture Alignment**: Follows existing script patterns like `scripts/validate-config.ts`.

---

### R6: Token Counting Strategy

**Decision**: Use upstream provider response data when available; count 0 if unavailable.

**Rationale**:
- OpenAI and Anthropic responses include token usage
- Accurate counting without additional processing
- Graceful degradation when token data unavailable
- No need for local tokenization

**Implementation Notes**:
- Extract `usage.prompt_tokens` and `usage.completion_tokens` from OpenAI responses
- Extract `usage.input_tokens` and `usage.output_tokens` from Anthropic responses
- Handle streaming responses by accumulating SSE events

---

## Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| bcrypt | ^5.1.1 | API key hashing |
| @types/bcrypt | ^5.0.2 | TypeScript types for bcrypt |

**Note**: `uuid` is already a dependency for key ID generation.

---

## Integration Points

### Existing Services to Modify

1. **src/app.ts**: Add auth middleware registration
2. **src/routes/index.ts**: Register new admin routes for key management
3. **src/index.ts**: Initialize ApiKeyManager and UsageTracker on startup

### New Files to Create

| File | Purpose |
|------|---------|
| `src/services/api-key-manager.ts` | Key CRUD operations |
| `src/services/usage-tracker.ts` | Usage tracking and persistence |
| `src/middleware/auth.ts` | Request authentication |
| `src/cli/api-key-cli.ts` | CLI command handlers |
| `src/types/api-key.ts` | API key type definitions |
| `src/types/usage.ts` | Usage record type definitions |
| `scripts/api-key.ts` | CLI entry point script |

---

## Configuration Changes

### New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS_PATH` | `./api-keys.json` | Path to API keys storage file |
| `USAGE_DATA_PATH` | `./usage-data.json` | Path to usage data file |
| `AUTH_EXEMPT_PATHS` | `` | Comma-separated paths to exempt from auth |
| `USAGE_SYNC_INTERVAL` | `60000` | Usage persistence interval (ms) |

### package.json Scripts to Add

```json
{
  "key:create": "ts-node scripts/api-key.ts create",
  "key:list": "ts-node scripts/api-key.ts list",
  "key:disable": "ts-node scripts/api-key.ts disable",
  "key:enable": "ts-node scripts/api-key.ts enable",
  "key:delete": "ts-node scripts/api-key.ts delete",
  "usage:report": "ts-node scripts/api-key.ts report"
}
```
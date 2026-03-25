# Research: CPG CLI Executable

**Branch**: `006-cpg-cli` | **Date**: 2026-03-25

## Research Tasks

### R-001: CLI Framework Selection

**Question**: What CLI framework should be used for the `cpg` executable?

**Decision**: Use native TypeScript implementation without external CLI framework.

**Rationale**:
- Existing `api-key-cli.ts` already implements custom argument parsing
- No additional dependencies required (aligns with SC-006)
- Simple command structure doesn't warrant framework overhead
- Node.js built-in `process.argv` and custom parsing sufficient

**Alternatives Considered**:
- **Commander.js**: Popular, but adds dependency. Rejected to minimize dependencies.
- **Yargs**: Feature-rich, but adds dependency. Rejected for same reason.
- **Oclif**: Heavy framework suited for complex CLIs. Overkill for this use case.

**Architecture Alignment**: Follows ADR-001 (Monolithic Single-Process Architecture) by keeping implementation simple and dependency-minimal.

---

### R-002: Executable Implementation Approach

**Question**: How should the `cpg` executable be implemented?

**Decision**: Create a Node.js executable script (`bin/cpg`) that runs via `node dist/cli/index.js`, with package.json `bin` field for npm installation.

**Rationale**:
- No native binary compilation required (per spec assumption)
- Works identically on host machine and Docker containers
- Simpler than pkg/nexe compilation
- Docker images already have Node.js runtime

**Implementation Details**:
```json
// package.json
{
  "bin": {
    "cpg": "./bin/cpg"
  }
}
```

```bash
#!/bin/bash
# bin/cpg
node "$(dirname "$0")/../dist/cli/index.js" "$@"
```

**Alternatives Considered**:
- **pkg/nexe**: Compile to native binary. Rejected - adds complexity, not required per spec.
- **Direct node execution**: `node dist/cli/index.js`. Rejected - less user-friendly than `cpg` command.

---

### R-003: Gateway Notification Mechanism

**Question**: How should CLI notify the running gateway of storage changes?

**Decision**: Implement `POST /internal/reload` endpoint on gateway that CLI calls after modifying storage.

**Rationale**:
- Per FR-011a specification
- Real-time updates without polling delay
- HTTP is simple and reliable for local communication
- Gateway already runs HTTP server (Fastify)

**Implementation Details**:
1. CLI calls `POST http://localhost:8080/internal/reload` after storage modification
2. Gateway endpoint triggers `ApiKeyManager.loadKeys()` to refresh in-memory state
3. Endpoint binds to localhost only (per SR-001)
4. No authentication required (per SR-002, localhost binding provides security)

**Alternatives Considered**:
- **File watcher on gateway**: Rejected - adds complexity, polling delay.
- **Shared memory**: Rejected - over-engineering for single-user scenario.
- **Signal-based (SIGUSR1)**: Rejected - requires process management, not Docker-friendly.

---

### R-004: Output Formatting Strategy

**Question**: How should CLI output be formatted for human and machine consumption?

**Decision**: Implement dual output formatters with `--json` flag to switch between them.

**Rationale**:
- Per FR-007 and FR-007a requirements
- Default human-readable output improves UX
- JSON output enables automation and scripting

**Implementation Details**:
```typescript
interface OutputFormatter {
  formatKeyCreate(result: CreateKeyResult): string;
  formatKeyList(keys: ApiKey[]): string;
  formatKeyTest(result: TestKeyResult): string;
  formatUsageReport(report: UsageReport): string;
  formatError(error: Error): string;
}

// --json flag switches between formatters
const formatter = args.json ? new JsonFormatter() : new TableFormatter();
```

---

### R-005: Key Test Command Implementation

**Question**: How should `cpg key test <key>` be implemented?

**Decision**: Call `ApiKeyManager.validateKeyWithStatus()` and display detailed status.

**Rationale**:
- Per FR-002b requirement
- Returns detailed status: valid, invalid, disabled, expired
- Uses existing validation logic in ApiKeyManager
- No gateway notification needed (read-only operation)

**Output Format**:
```
Key: cpg_xxxx...xxxx
Status: valid
Key ID: uuid-here
Name: My Key
Created: 2026-03-25
Expires: 2026-12-31
```

---

### R-006: Docker Integration Approach

**Question**: How should the CLI be integrated into Docker images?

**Decision**: Include CLI executable in Docker image at build time, accessible via `docker exec`.

**Rationale**:
- Per FR-009 and FR-010 requirements
- No additional Docker layers needed
- CLI shares same dependencies as gateway
- Works with existing Node.js runtime in image

**Dockerfile Changes**:
```dockerfile
# Copy CLI entry point
COPY bin/cpg ./bin/cpg
RUN chmod +x bin/cpg

# Ensure CLI is in PATH
ENV PATH="/app/bin:${PATH}"
```

**Usage**:
```bash
docker exec gateway cpg key create --name "Test Key"
docker exec gateway cpg key list
```

---

### R-007: Error Handling Strategy

**Question**: How should CLI handle errors and edge cases?

**Decision**: Implement comprehensive error handling with clear exit codes and messages.

**Exit Codes**:
- `0`: Success
- `1`: General error (invalid arguments, operation failed)
- `2`: Configuration error (missing ENCRYPTION_KEY, etc.)
- `3`: Network error (gateway unreachable)
- `4`: Storage error (file not accessible)

**Error Message Format**:
```
Error: [error type]
  [description]

Suggestion: [actionable fix]
```

---

## Research Summary

| Research Task | Decision | Key Rationale |
|---------------|----------|---------------|
| R-001: CLI Framework | Native TypeScript, no external framework | Minimize dependencies, existing pattern |
| R-002: Executable | Node.js script with package.json bin | Works in Docker, no compilation needed |
| R-003: Gateway Notification | HTTP POST to /internal/reload | Real-time, simple, Docker-friendly |
| R-004: Output Formatting | Dual formatters with --json flag | Human + machine readable |
| R-005: Key Test | Use existing validateKeyWithStatus | Reuses validation logic |
| R-006: Docker Integration | Include in image, accessible via docker exec | No additional layers needed |
| R-007: Error Handling | Exit codes + clear messages | Actionable user feedback |

## Dependencies

No new external dependencies required. Implementation uses existing:
- Node.js built-in modules (process, fs, path)
- Fastify (for gateway notification endpoint)
- Zod (for argument validation)
- bcrypt (for key validation)

## Next Steps

Proceed to Phase 1: Design & Contracts
- Generate data-model.md
- Generate contracts/
- Generate quickstart.md
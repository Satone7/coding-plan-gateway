# Technical Design: Docker Auto-Update

**Branch**: `016-docker-auto-update` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/016-docker-auto-update/spec.md`

## Summary

Implement an automatic update mechanism for Docker containers that checks for new code commits on startup, pulls the latest code, rebuilds, and restarts the service if updates are available. The solution uses a shell-based entrypoint script that orchestrates git operations, builds, and service startup with robust error handling and rollback capabilities.

## Technical Context

**Language/Version**: Bash 4.x + Node.js 20 LTS
**Primary Dependencies**: Git 2.x, npm, standard Unix tools (curl/wget, sha256sum)
**Storage**: Filesystem-based (build artifacts, status files)
**Testing**: Shell script linting (shellcheck), integration tests with Docker
**Target Platform**: Linux AMD64/ARM64 (Alpine-based containers)
**Project Type**: Single project - shell scripts extending existing Node.js service
**Performance Goals**: <30s startup time (no updates), <2min complete update cycle
**Constraints**: Must work in air-gapped environments (graceful fallback), minimal image size increase (<10MB)
**Scale/Scope**: Single container instance per deployment

## Ground-rules Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | Pass | Shell scripts follow POSIX conventions, single responsibility functions |
| II. Testing | Pass | Integration tests via Docker, shellcheck for script validation |
| III. User Experience | Pass | Clear logging, automatic fallback on errors, no manual intervention required |
| IV. Performance | Pass | <30s startup meets <50ms routing overhead requirement from architecture |

## Project Structure

### Documentation (this feature)

```text
specs/016-docker-auto-update/
├── design.md              # This file
├── research.md            # Phase 0 research output
├── data-model.md          # Entity definitions
├── quickstart.md          # User guide
├── contracts/
│   └── auto-update-api.yaml  # Internal API spec
└── tasks.md               # Phase 2 task breakdown (future)
```

### Source Code (repository root)

```text
docker/
├── autoupdate/
│   ├── entrypoint.sh          # Main orchestration script
│   ├── lib/
│   │   ├── git.sh             # Git operations
│   │   ├── build.sh           # Build process
│   │   ├── health.sh          # Health checks
│   │   └── logging.sh         # Structured logging
│   └── Dockerfile.autoupdate  # Extended production image
├── Dockerfile                 # Standard production image
└── docker-compose.yml

scripts/
├── autoupdate-check.sh        # Manual check script
└── test-autoupdate.sh         # Integration tests
```

**Structure Decision**: Single project with Docker-specific scripts in `docker/autoupdate/` directory. Shell libraries organized under `lib/` for modularity. Integration with existing Node.js application through `entrypoint.sh` which calls the original `node dist/index.js` after update checks.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                          │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────┐             │
│  │   entrypoint.sh │───►│  Update Check     │             │
│  │   (orchestrator)│    │  - git ls-remote  │             │
│  └────────┬────────┘    │  - compare commit │             │
│           │             └─────────┬──────────┘             │
│           │                       │                       │
│           │           ┌───────────▼───────────┐            │
│           │           │      No Update       │            │
│           │           │  → Start existing    │            │
│           │           │    build            │            │
│           │           └─────────┬───────────┘            │
│           │                     │                        │
│           │           ┌─────────▼──────────┐             │
│           │           │    Update Found    │             │
│           │           │  → git fetch       │             │
│           │           │  → npm ci          │             │
│           │           │  → npm run build   │             │
│           │           └─────────┬──────────┘             │
│           │                     │                        │
│           │           ┌─────────▼──────────┐             │
│           └──────────►│   Build Success    │             │
│                       │  → Backup old      │             │
│                       │  → Swap builds     │             │
│                       │  → Start service   │             │
│                       └──────────────────┘             │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Error Handling (any stage)                      │  │
│  │  → Log error details                              │  │
│  │  → Restore backup if exists                       │  │
│  │  → Start with last known good build               │  │
│  │  → Continue monitoring/retries per config           │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Startup**: `entrypoint.sh` reads environment configuration
2. **Check**: Query remote Git HEAD without full clone
3. **Decision**: Compare with local cached commit hash
4. **No Update**: Start existing build directly
5. **Update Available**:
   - Fetch latest code
   - Install dependencies
   - Run build
   - Validate build output
   - Atomically swap builds
6. **Error Handling**: Restore backup, log details, start with last known good

## Error Handling Strategy

| Scenario | Detection | Response | Logging |
|----------|-----------|----------|---------|
| Network unavailable | curl/wget failure | Skip update, start existing | ERROR level, error code |
| Git auth failure | HTTP 401/403 from git | Skip update, start existing | ERROR level, sanitize creds |
| Git fetch timeout | Timeout on fetch | Retry with backoff, then fail | WARN then ERROR |
| Build failure | npm run build exit != 0 | Restore backup, start existing | ERROR with build output |
| Build timeout | Build exceeds limit | Kill process, restore, start | ERROR with duration |
| Health check fails | App doesn't respond | Revert to backup, restart | CRITICAL with diagnostics |
| Disk full | Build fails with ENOSPC | Clean temp, skip update | ERROR with disk usage |

## Rollback Mechanism

```
Before Update:
  /app/dist/          <- Current build

During Update (atomic swap):
  /app/dist/          <- Backed up to dist.backup
  /app/dist.new/      <- New build being created
  
After Successful Build:
  /app/dist.backup/   <- Preserved for quick rollback
  /app/dist/          <- Atomically swapped from dist.new

On Failure:
  if dist.backup exists:
    rm -rf dist/
    mv dist.backup dist/
    start service
```

## Performance Considerations

- **Startup time**: Target <30s (no update), <2min (with update)
- **Disk usage**: Keep at most 2 builds (current + backup)
- **Network**: Use shallow clone if possible, but full history needed for proper versioning
- **CPU**: Build process is CPU-intensive; consider build resource limits

## Security Considerations

- **Credential handling**: Never log tokens or keys; use environment variables only
- **File permissions**: SSH keys must be 0600, config files 0644 or more restrictive
- **Network**: Verify TLS certificates (no insecure skip)
- **Build isolation**: Build in temporary directory before atomic swap

## Monitoring & Observability

### Metrics to Track

- `autoupdate.checks.total` - Total update checks performed
- `autoupdate.checks.failed` - Failed update checks
- `autoupdate.updates.available` - Updates found
- `autoupdate.updates.applied` - Updates successfully applied
- `autoupdate.updates.failed` - Failed update attempts
- `autoupdate.duration.seconds` - Time taken for update operations

### Log Events

- `UPDATE_CHECK_START` - Beginning update check
- `UPDATE_CHECK_COMPLETE` - Check completed (with result)
- `UPDATE_FETCH_START` - Beginning git fetch
- `UPDATE_FETCH_COMPLETE` - Git fetch complete
- `UPDATE_BUILD_START` - Beginning build
- `UPDATE_BUILD_COMPLETE` - Build complete
- `UPDATE_ROLLBACK` - Rollback triggered
- `UPDATE_ERROR` - Error occurred (with details)

## References

- [Docker Auto-Update Specification](../spec.md)
- [Data Model](../data-model.md)
- [API Contract](./auto-update-api.yaml)
- [Coding Plan Gateway Architecture](../../docs/architecture.md)

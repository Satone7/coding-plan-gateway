# Research: Docker Auto-Update

**Date**: 2026-03-31  
**Feature**: Docker Auto-Update  
**Status**: Complete

## 1. Git Authentication Patterns

### Decision: Support Both HTTPS Token and SSH Key

**Rationale**:
- HTTPS Token: Easier to configure in CI/CD, works through proxies, simple to rotate
- SSH Key: More secure, supports passphrase protection, standard for enterprise environments
- Both are industry standard and widely used

**Implementation**:
- HTTPS: Use `GIT_TOKEN` environment variable, format `https://oauth2:${TOKEN}@git.example.com/repo.git`
- SSH: Mount SSH key via volume at `/root/.ssh/id_rsa`, set proper permissions (0600)

## 2. Update Check Strategy

### Decision: Remote HEAD Check Before Full Clone

**Rationale**:
- Avoid unnecessary git operations
- Reduce network overhead
- Faster startup when no updates available

**Implementation**:
```bash
# Get remote HEAD without cloning
git ls-remote --heads origin ${BRANCH} | cut -f1

# Compare with local cached commit
if [ "$REMOTE_COMMIT" != "$LOCAL_COMMIT" ]; then
    # Proceed with update
fi
```

## 3. Build Process

### Decision: Use npm run build with TypeScript compilation

**Rationale**:
- Matches existing project structure
- TypeScript provides type safety
- Standard Node.js/npm workflow

**Implementation**:
```bash
npm ci --only=production=false  # Install dev dependencies for build
npm run build                   # Compile TypeScript to dist/
npm ci --only=production        # Remove dev dependencies
```

## 4. Rollback Strategy

### Decision: Keep Last Known Good Build

**Rationale**:
- Fast rollback (no rebuild required)
- Minimal disk usage (just one backup)
- Simple implementation

**Implementation**:
```bash
# Before update: backup current build
if [ -d "dist" ]; then
    mv dist dist.backup
fi

# On failure: restore backup
if [ $? -ne 0 ]; then
    rm -rf dist
    mv dist.backup dist
fi
```

## 5. Logging Strategy

### Decision: Structured JSON Logging to stdout

**Rationale**:
- Compatible with Docker logging drivers
- Easy parsing by log aggregation systems
- Consistent with existing application logging

**Implementation**:
```json
{"level":"info","timestamp":"2026-03-31T10:30:00Z","event":"UPDATE_CHECK","message":"Checking for updates","branch":"master","currentCommit":"abc123"}
```

## 6. Configuration via Environment Variables

### Decision: Prefix all variables with AUTOUPDATE_

**Rationale**:
- Clear namespace prevents conflicts
- Self-documenting
- Follows 12-factor app principles

**Configuration Options**:
| Variable | Default | Description |
|----------|---------|-------------|
| AUTOUPDATE_ENABLED | true | Enable/disable auto-update |
| AUTOUPDATE_BRANCH | master | Git branch to track |
| AUTOUPDATE_CHECK_INTERVAL | 0 | Periodic check interval in seconds (0=only at startup) |
| AUTOUPDATE_GIT_URL | - | Git repository URL |
| AUTOUPDATE_GIT_TOKEN | - | HTTPS token for authentication |
| AUTOUPDATE_SSH_KEY_PATH | /root/.ssh/id_rsa | SSH key path |

## 7. Architecture Alignment

This feature aligns with existing architecture decisions:

- **ADR-001 (Monolithic)**: Auto-update is a shell script executed at container startup, not a separate service
- **ADR-002 (File-Based Config)**: Configuration via environment variables follows existing patterns
- **ADR-003 (In-Memory Quota)**: Not applicable - this feature doesn't interact with quota tracking

## 8. References

- [Git Credential Storage](https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage)
- [Dockerfile Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [12-Factor App Config](https://12factor.net/config)

# Research: E2E Docker Testing Environment

**Feature**: 003-e2e-docker-testing
**Date**: 2026-03-24

## Research Summary

This document captures research findings for implementing the e2e Docker testing environment.

---

## 1. Claude Code CLI Installation in Docker

### Decision
Install Claude Code CLI via npm in a Node.js-based Docker image.

### Rationale
- Claude Code is distributed as an npm package (`@anthropic-ai/claude-code`)
- Node.js 20+ LTS is required (matches project requirements)
- npm installation is straightforward and version-controllable

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| Pre-built image | No official Claude Code Docker image exists |
| Binary download | npm installation is simpler and handles dependencies |
| Global npm install | Local install preferred for version isolation |

### Architecture Alignment
Aligns with ADR-001 (Monolithic Single-Process) - keeping infrastructure simple and consistent.

---

## 2. Docker Compose Network Configuration

### Decision
Use Docker Compose's default bridge network with service name resolution.

### Rationale
- Default bridge network provides automatic DNS resolution between containers
- Gateway accessible via service name `gateway` on port 8080
- No custom network configuration needed for single-host deployment

### Implementation
```yaml
services:
  gateway:
    # Gateway runs on port 8080
    ports:
      - "8080:8080"

  claude-code:
    environment:
      - ANTHROPIC_BASE_URL=http://gateway:8080
    depends_on:
      - gateway
```

### Architecture Alignment
Aligns with ADR-001 (local deployment) and ADR-002 (simple configuration).

---

## 3. Configuration File Mounting Strategy

### Decision
Mount configuration files as read-only volumes from host to container.

### Rationale
- Allows developers to edit configs with their preferred tools
- Changes visible immediately (with gateway hot-reload)
- Separates secrets from Docker images
- Follows Docker best practices for configuration injection

### Implementation
```yaml
services:
  gateway:
    volumes:
      - ./test-config.yaml:/app/config.yaml:ro
```

### Alternatives Considered
| Alternative | Rejected Because |
|-------------|------------------|
| Environment variables | Spec requires config file mount |
| Build-time COPY | Requires rebuild for config changes |
| Config server | Overly complex for local testing |

### Architecture Alignment
Aligns with ADR-002 (File-Based Configuration Storage) and the clarification for config file mount.

---

## 4. Log Volume Mounting

### Decision
Create host directories for logs and mount them as volumes in both containers.

### Rationale
- Persistent logs survive container restarts
- Developers can use host tools (grep, text editors) to view logs
- Simple directory structure easy to navigate
- Aligns with clarification: "Mounted volumes - Write logs to host-mounted directories"

### Implementation
```yaml
services:
  gateway:
    volumes:
      - ./logs/gateway:/app/logs

  claude-code:
    volumes:
      - ./logs/claude-code:/root/.claude/logs
```

---

## 5. Claude Code Environment Variables

### Decision
Configure Claude Code via environment variables: `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`.

### Rationale
- Claude Code CLI supports these environment variables natively
- Simple configuration without modifying config files
- Clear documentation in docker-compose.yml

### Required Variables
| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_BASE_URL` | `http://gateway:8080` | Route requests through gateway |
| `ANTHROPIC_MODEL` | `kimi-k2.5` | Default model to use |

---

## 6. Container Lifecycle Management

### Decision
Provide npm scripts for environment lifecycle: start, stop, reset.

### Rationale
- Familiar interface for Node.js developers
- Single source of truth for commands
- Easy to extend with additional functionality

### Scripts
| Command | Action |
|---------|--------|
| `npm run e2e:start` | Build and start all containers |
| `npm run e2e:stop` | Stop all containers |
| `npm run e2e:reset` | Stop, remove volumes, rebuild |
| `npm run e2e:logs` | Tail logs from all containers |

---

## 7. Sample Configuration Template

### Decision
Provide `test-config.example.yaml` with placeholder values, documented with comments.

### Rationale
- Clear template for developers to copy and customize
- Inline documentation explains each field
- Placeholder values make it obvious what needs to be replaced
- Aligns with clarification: "Sample with placeholders"

### Template Structure
```yaml
# Test configuration for E2E testing
# Copy this file to test-config.yaml and fill in your values

plans:
  - id: "test-plan-1"
    name: "Test Kimi Plan"
    baseUrl: "https://api.moonshot.cn/v1"  # Kimi API endpoint
    apiKey: "YOUR_KIMI_API_KEY_HERE"        # Replace with your API key
    models:
      - "kimi-k2.5"
    quota:
      limit: 1000
      used: 0
      period: "daily"
```

---

## 8. Dockerfile for Claude Code Container

### Decision
Create a minimal Dockerfile based on Node.js 20 LTS with Claude Code CLI installed.

### Rationale
- Node.js 20 LTS matches project requirements
- Minimal image reduces attack surface and build time
- Non-root user for security best practices

### Base Image
`node:20-bookworm-slim` (Debian-based, minimal footprint)

---

## Open Questions (None)

All technical decisions have been resolved through the clarification process and research.
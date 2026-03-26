# E2E Docker Testing Environment

This directory contains the end-to-end testing infrastructure for the Coding Plan Gateway.

## Key Design Decisions

- **Uses production config.yaml**: E2E tests use the same `config.yaml` as production to test with real coding plans
- **Isolated data volumes**: Test data is stored in Docker named volumes, separate from production
- **Different container names**: Containers are named `gateway-e2e` and `claude-code-e2e` to avoid conflicts
- **Different port**: Gateway runs on port 8081 (vs 8080 for production) to allow both to run simultaneously

## Quick Start

```bash
# 1. Ensure config.yaml exists with your coding plans
cat config.yaml

# 2. Start the E2E environment
npm run e2e:start

# 3. Run tests
npm run test:e2e

# 4. Stop the environment
npm run e2e:stop
```

## Directory Structure

```
e2e/
├── Dockerfile              # Claude Code container definition
├── workspace/              # Mounted workspace for testing
└── README.md               # This file
```

## Configuration

### Using Production Config

The E2E environment mounts `config.yaml` from the repository root (read-only). This ensures:

1. Tests use real coding plan configurations
2. No separate config file to maintain
3. Tests are always in sync with production configuration

### Data Isolation

Test data is stored in Docker named volumes:

| Volume | Purpose |
|--------|---------|
| `e2e-api-keys` | API keys created during tests |
| `e2e-logs` | Gateway logs |
| `e2e-claude-logs` | Claude Code logs |

This prevents test data from polluting production storage.

## Container Details

| Container | Port | Purpose |
|-----------|------|---------|
| `gateway-e2e` | 8081 | Gateway service for testing |
| `claude-code-e2e` | - | Claude Code test client |

## Environment Variables

### Gateway (gateway-e2e)

| Variable | Value | Description |
|----------|-------|-------------|
| `ENCRYPTION_KEY` | 64-char hex | API key encryption key |
| `LOG_LEVEL` | debug | Verbose logging for tests |
| `AUTH_EXEMPT_PATHS` | /health,/ready,/internal/* | Paths without auth |

### Claude Code (claude-code-e2e)

| Variable | Value | Description |
|----------|-------|-------------|
| `ANTHROPIC_BASE_URL` | http://gateway:8080 | Gateway endpoint |
| `ANTHROPIC_MODEL` | kimi-k2.5 | Default model |
| `ANTHROPIC_API_KEY` | cpg_... | Test API key |

## Running Tests

### All E2E Tests

```bash
npm run test:e2e
```

### Specific Test File

```bash
npx vitest run tests/e2e/e2e-cli.test.ts
npx vitest run tests/e2e/docker-cli.test.ts
```

### Interactive Testing

```bash
# Start an interactive Claude Code session
docker exec -it claude-code-e2e claude

# Test gateway health
curl http://localhost:8081/health

# List available models
curl http://localhost:8081/v1/models
```

## Test Scenarios

### Load Balancing Tests

The E2E tests verify:

1. **Model listing**: Models from config.yaml are available
2. **Passthrough**: Custom parameters are preserved in requests
3. **Request routing**: Requests are routed to available plans
4. **Load distribution**: Multiple requests are distributed fairly
5. **Health checks**: Gateway remains healthy under load

### Key Management Tests

1. **Key creation**: Create API keys via CLI
2. **Key listing**: List all created keys
3. **Key validation**: Test key validity
4. **Key lifecycle**: Disable/enable keys

## Troubleshooting

### Container won't start

```bash
# Check Docker is running
docker info

# Check for port conflicts
lsof -i :8081

# View gateway logs
docker logs gateway-e2e
```

### Config file errors

```bash
# Verify config.yaml exists
ls -la config.yaml

# Validate YAML syntax
cat config.yaml
```

### Clean up and restart

```bash
# Stop and remove containers
npm run e2e:stop

# Remove volumes for clean slate
docker volume rm e2e-api-keys e2e-logs e2e-claude-logs 2>/dev/null || true

# Start fresh
npm run e2e:start
```

## Security Notes

- **Never commit config.yaml** - It contains real API keys
- **Test data is isolated** - Named volumes don't affect production
- **Different port** - 8081 prevents accidental production access
- **Read-only config** - Tests cannot modify the configuration
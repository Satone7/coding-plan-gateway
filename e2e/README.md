# E2E Docker Testing Environment

This directory contains the end-to-end testing infrastructure for the Coding Plan Gateway.

## Table of Contents

- [Quick Start](#quick-start)
- [Step-by-Step Testing Guide](#step-by-step-testing-guide)
- [Test Scenarios](#test-scenarios)
- [Directory Structure](#directory-structure)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Logs](#logs)
- [Troubleshooting](#troubleshooting)
- [Cleanup](#cleanup)

## Quick Start

1. **Configure the environment**:
   ```bash
   cp test-config.example.yaml test-config.yaml
   # Edit test-config.yaml with your API key
   ```

2. **Start the environment**:
   ```bash
   npm run e2e:start
   ```

3. **Run Claude Code interactively**:
   ```bash
   docker exec -it claude-code claude
   ```

4. **Stop the environment**:
   ```bash
   npm run e2e:stop
   ```

## Step-by-Step Testing Guide

### Step 1: Prerequisites Check

Before starting, verify your environment:

```bash
# Check Docker is running
docker info

# Check you're in the project root
ls -la package.json docker-compose.e2e.yml

# Check config template exists
ls -la e2e/test-config.example.yaml
```

**Expected Output**: All commands should succeed without errors.

### Step 2: Configure the Gateway

1. Copy the example configuration:
   ```bash
   cp e2e/test-config.example.yaml e2e/test-config.yaml
   ```

2. Edit `e2e/test-config.yaml` with your API key:
   ```bash
   # Replace YOUR_KIMI_API_KEY_HERE with your actual API key
   nano e2e/test-config.yaml
   ```

3. Verify the configuration is valid:
   ```bash
   cat e2e/test-config.yaml
   ```

**Expected Output**: You should see your configuration with a valid API key.

### Step 3: Start the Environment

```bash
npm run e2e:start
```

**Expected Behavior**:
- Docker images are built (first time only)
- Gateway container starts first
- Claude Code container starts after gateway is healthy
- Both containers show "Up" status

**Verification**:
```bash
npm run e2e:status
```

**Expected Output**:
```
E2E Environment Status:
=======================

Docker:      running

Gateway:     Up X seconds (healthy)
Claude Code: Up X seconds

Config:      valid
Logs:        /path/to/logs/
Health:      OK
```

### Step 4: Verify Gateway Connectivity

Test that the gateway is accessible:

```bash
# Check gateway health endpoint (from host)
curl -s http://localhost:8080/health

# Check available models (from host)
curl -s http://localhost:8080/v1/models | jq .
```

**Expected Output**:
- Health endpoint returns: `{"status":"ok"}`
- Models endpoint includes `kimi-k2.5` in the list

### Step 5: Verify Inter-Container Network

Test that Claude Code container can reach the gateway:

```bash
# Test from inside Claude Code container
docker exec claude-code curl -s http://gateway:8080/health
docker exec claude-code curl -s http://gateway:8080/v1/models
```

**Expected Output**: Same as Step 4, confirming network connectivity.

### Step 6: Run Claude Code Interactively

Start an interactive Claude Code session:

```bash
docker exec -it claude-code claude
```

**Expected Behavior**:
- Claude Code starts and connects to the gateway
- You can interact with Claude using the configured model
- Requests are routed through the gateway

### Step 7: Verify Request Routing

After sending a message in Claude Code, check the gateway logs:

```bash
# View gateway logs
npm run e2e:logs

# Or directly
tail -f logs/gateway/*.log
```

**Expected Output**: Logs show incoming requests with model and routing information.

### Step 8: Stop and Cleanup

When done testing:

```bash
# Stop the environment
npm run e2e:stop

# For complete cleanup (removes containers and images)
npm run e2e:reset
```

## Test Scenarios

### Scenario 1: Basic Connectivity Test

**Objective**: Verify Claude Code container can reach the gateway.

**Steps**:
1. Start environment: `npm run e2e:start`
2. Check health: `docker exec claude-code curl -s http://gateway:8080/health`
3. Stop environment: `npm run e2e:stop`

**Expected Result**: Health check returns `{"status":"ok"}`

### Scenario 2: Model Availability Test

**Objective**: Verify configured models are available.

**Steps**:
1. Start environment: `npm run e2e:start`
2. List models: `curl -s http://localhost:8080/v1/models | jq '.data[].id'`
3. Stop environment: `npm run e2e:stop`

**Expected Result**: Output includes `"kimi-k2.5"`

### Scenario 3: Full Request Cycle Test

**Objective**: Verify complete request-response cycle.

**Steps**:
1. Start environment: `npm run e2e:start`
2. Start Claude Code: `docker exec -it claude-code claude`
3. Send a simple prompt (e.g., "Say hello")
4. Verify response is received
5. Check logs for request trace
6. Exit Claude Code (Ctrl+C or `/exit`)
7. Stop environment: `npm run e2e:stop`

**Expected Result**: Claude responds correctly, logs show request processing.

### Scenario 4: Environment Reproducibility Test

**Objective**: Verify environment can be recreated cleanly.

**Steps**:
1. Stop and reset: `npm run e2e:reset`
2. Start fresh: `npm run e2e:start`
3. Verify status: `npm run e2e:status`

**Expected Result**: Environment starts successfully with clean state.

## Directory Structure

```
e2e/
├── Dockerfile              # Claude Code container definition
├── test-config.example.yaml # Configuration template
├── test-config.yaml        # Your config (gitignored)
├── workspace/              # Mounted workspace for testing
└── README.md               # This file
```

## Configuration

The `test-config.yaml` file defines coding plans for the gateway. Copy from `test-config.example.yaml` and customize:

- `id`: Unique identifier (UUID format)
- `name`: Human-readable plan name
- `baseUrl`: Upstream provider API endpoint
- `apiKey`: Your API key for authentication
- `models`: List of supported model names
- `quota`: Request limits and tracking

### Configuration Example

```yaml
plans:
  - id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    name: "Test Kimi K2.5 Plan"
    baseUrl: "https://api.moonshot.cn/v1"
    apiKey: "your-api-key-here"
    models:
      - "kimi-k2.5"
    quota:
      limit: 1000
      used: 0
      period: "daily"
    timeout: 30000
```

## Environment Variables

Claude Code is configured via environment variables in `docker-compose.e2e.yml`:

| Variable | Value | Description |
|----------|-------|-------------|
| `ANTHROPIC_BASE_URL` | `http://gateway:8080` | Gateway endpoint |
| `ANTHROPIC_MODEL` | `kimi-k2.5` | Default model to use |

Gateway environment variables:

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | 64-character hex string for API key encryption |
| `LOG_LEVEL` | Logging verbosity (debug, info, warn, error) |

## Logs

Logs are captured in the `logs/` directory at repository root:

- `logs/gateway/`: Gateway service logs
- `logs/claude-code/`: Claude Code container logs

### Viewing Logs

```bash
# View all logs
npm run e2e:logs

# Follow gateway logs specifically
tail -f logs/gateway/*.log

# View Claude Code logs
tail -f logs/claude-code/*.log
```

## Troubleshooting

### Container won't start

**Symptoms**: `npm run e2e:start` fails or containers exit immediately.

**Diagnosis**:
```bash
# Check Docker is running
docker info

# Check for container errors
docker logs gateway
docker logs claude-code

# Check config exists
ls -la e2e/test-config.yaml
```

**Solutions**:
1. Ensure Docker is running: `systemctl start docker` or open Docker Desktop
2. Verify config file exists: `cp e2e/test-config.example.yaml e2e/test-config.yaml`
3. Check for port conflicts: `lsof -i :8080`

### Gateway not accessible

**Symptoms**: Health check fails, connection refused.

**Diagnosis**:
```bash
# Check container status
npm run e2e:status

# Check gateway logs
docker logs gateway

# Test from host
curl -v http://localhost:8080/health
```

**Solutions**:
1. Wait for health check to pass (up to 30 seconds)
2. Check ENCRYPTION_KEY environment variable (must be 64 hex characters)
3. Verify config file is valid YAML

### Health check failing repeatedly

**Symptoms**: Gateway container keeps restarting, health check times out.

**Diagnosis**:
```bash
# Check gateway logs for errors
docker logs gateway 2>&1 | tail -50
```

**Common Causes**:
1. Missing `ENCRYPTION_KEY` environment variable
2. Invalid configuration file (check UUID format, API key format)
3. Port already in use

**Solutions**:
```bash
# Verify ENCRYPTION_KEY is set correctly
docker-compose -f docker-compose.e2e.yml config | grep ENCRYPTION_KEY

# Validate configuration
cat e2e/test-config.yaml
```

### API key errors

**Symptoms**: "Unauthorized" or "Invalid API key" errors.

**Diagnosis**:
```bash
# Check API key in config
cat e2e/test-config.yaml | grep apiKey
```

**Solutions**:
1. Verify API key is correct and active
2. Check key is valid with your provider (e.g., test direct API call)
3. Ensure no extra whitespace in config file

### Network connectivity issues

**Symptoms**: Claude Code cannot reach gateway.

**Diagnosis**:
```bash
# Check network exists
docker network ls | grep e2e

# Test connectivity from Claude Code container
docker exec claude-code ping -c 3 gateway
docker exec claude-code curl -v http://gateway:8080/health
```

**Solutions**:
1. Recreate the network: `docker network create e2e-network`
2. Restart containers: `npm run e2e:reset && npm run e2e:start`

### Claude Code exits immediately

**Symptoms**: Running `docker exec -it claude-code claude` exits or shows errors.

**Diagnosis**:
```bash
# Check Claude Code logs
docker logs claude-code

# Try running with verbose output
docker exec -it claude-code claude --verbose
```

**Solutions**:
1. Ensure gateway is healthy first
2. Check ANTHROPIC_BASE_URL is correct (should be `http://gateway:8080`)
3. Verify model name matches config

## Cleanup

### Stop Running Containers

```bash
npm run e2e:stop
```

This stops containers but preserves images for faster restart.

### Complete Cleanup

```bash
npm run e2e:reset
```

This removes:
- All containers
- Built images
- Networks (if unused)

### Manual Cleanup

```bash
# Stop specific containers
docker stop gateway claude-code

# Remove containers
docker rm gateway claude-code

# Remove images
docker rmi coding-plan-gateway:test claude-code-test

# Remove network
docker network rm e2e-network

# Clean up logs
rm -rf logs/gateway/* logs/claude-code/*
```

## Performance Benchmarks

The following benchmarks help verify the environment meets success criteria:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Startup Time | < 60 seconds | `time npm run e2e:start` |
| Cleanup Time | < 30 seconds | `time npm run e2e:reset` |
| Health Check | < 5 seconds | `curl -s http://localhost:8080/health` |

## Security Notes

- API keys are encrypted at rest using AES-256
- Never commit `e2e/test-config.yaml` to version control
- The `logs/` directory is excluded from git
- Containers run as non-root users where possible
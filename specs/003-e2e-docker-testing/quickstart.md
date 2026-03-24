# Quick Start: E2E Docker Testing Environment

**Feature**: 003-e2e-docker-testing
**Date**: 2026-03-24

## Prerequisites

- Docker Desktop or Docker Engine installed and running
- Docker Compose v2+
- Node.js 20+ LTS
- Valid API key for an upstream provider (e.g., Kimi/Moonshot)

---

## Quick Start (3 Steps)

### 1. Configure the Test Environment

```bash
# Copy the example configuration
cp e2e/test-config.example.yaml e2e/test-config.yaml

# Edit with your API key
nano e2e/test-config.yaml
```

Replace `YOUR_KIMI_API_KEY_HERE` with your actual API key.

### 2. Start the Environment

```bash
npm run e2e:start
```

Wait for the environment to become ready (typically 30-60 seconds).

### 3. Run Claude Code Interactively

```bash
docker exec -it claude-code claude
```

You're now running Claude Code configured to use the gateway!

---

## Verify Everything Works

### Check Gateway is Running

```bash
curl http://localhost:8080/health
```

Expected response:
```json
{"status":"ok","timestamp":"2026-03-24T00:00:00.000Z"}
```

### Check Available Models

```bash
curl http://localhost:8080/v1/models
```

Expected response includes `kimi-k2.5` in the model list.

### View Gateway Logs

```bash
tail -f logs/gateway/gateway.log
```

### View Claude Code Logs

```bash
tail -f logs/claude-code/claude-code.log
```

---

## Common Tasks

### Stop the Environment

```bash
npm run e2e:stop
```

### View All Logs

```bash
npm run e2e:logs
```

### Reset Everything (Clean Slate)

```bash
npm run e2e:reset
```

### Check Environment Status

```bash
npm run e2e:status
```

---

## Troubleshooting

### "Docker daemon not running"

**Problem**: Docker is not started.

**Solution**: Start Docker Desktop or run `sudo systemctl start docker`.

---

### "test-config.yaml not found"

**Problem**: Configuration file doesn't exist.

**Solution**: Copy the example file and configure:
```bash
cp e2e/test-config.example.yaml e2e/test-config.yaml
# Edit with your API key
```

---

### "Gateway failed to start within 60 seconds"

**Problem**: Gateway container is unhealthy.

**Solution**:
1. Check gateway logs: `tail -f logs/gateway/error.log`
2. Verify configuration is valid
3. Check for port conflicts: `lsof -i :8080`

---

### "API key invalid" or "Unauthorized"

**Problem**: API key in config is incorrect.

**Solution**:
1. Verify your API key is correct
2. Ensure no extra whitespace in the config file
3. Check the API key works directly with the provider

---

### "Model not found" or "Model not available"

**Problem**: The configured model isn't supported by the provider.

**Solution**:
1. Verify the model name matches the provider's documentation
2. Update `models` array in config to match actual model names
3. For Kimi, the model should be `kimi-k2.5` (check current model names)

---

## Directory Structure

```
e2e/
├── Dockerfile              # Claude Code container
├── test-config.example.yaml # Template config (committed)
├── test-config.yaml        # Your config (gitignored)
├── workspace/              # Mounted workspace
└── README.md               # Detailed guide

logs/
├── gateway/                # Gateway logs
│   ├── gateway.log
│   ├── error.log
│   └── access.log
└── claude-code/            # Claude Code logs
    └── claude-code.log
```

---

## Configuration Reference

### test-config.yaml

```yaml
plans:
  - id: "your-plan-id"           # Unique identifier
    name: "Your Plan Name"        # Human-readable name
    baseUrl: "https://api.provider.com/v1"  # Provider API URL
    apiKey: "your-api-key"        # Your API key
    models:
      - "kimi-k2.5"               # Supported model names
    quota:
      limit: 1000                 # Max requests per period
      used: 0                     # Current usage (managed by gateway)
      period: "daily"             # "daily", "monthly", or "total"
    timeout: 30000                # Request timeout in ms (optional)
```

---

## Next Steps

1. **Interactive Testing**: Use Claude Code to test various scenarios
2. **Monitor Logs**: Watch the gateway logs to understand request flow
3. **Test Error Cases**: Try invalid requests to see error handling
4. **Multiple Plans**: Add multiple plans to test load balancing

For detailed documentation, see:
- [spec.md](./spec.md) - Feature specification
- [design.md](./design.md) - Technical design
- [data-model.md](./data-model.md) - Data structures
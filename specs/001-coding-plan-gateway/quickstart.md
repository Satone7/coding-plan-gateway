# Quick Start: Coding Plan Gateway

**Feature**: 001-coding-plan-gateway | **Date**: 2026-03-20

## Overview

Get the Coding Plan Gateway running in under 5 minutes.

---

## Prerequisites

- Node.js 20+ LTS
- npm or yarn
- At least one AI provider API key

---

## Quick Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env` file:
```bash
# Encryption key for API keys (generate a secure 32-byte hex string)
ENCRYPTION_KEY=your-32-byte-hex-encryption-key-here

# Server port (optional, default: 8080)
PORT=8080

# Log level (optional, default: info)
LOG_LEVEL=info
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Create Initial Configuration

Create `config/plans.yaml`:
```yaml
plans:
  - name: "Kimi K2.5"
    baseUrl: "https://api.moonshot.cn/v1"
    apiKey: "${KIMI_API_KEY}"  # Set in environment
    models:
      - "kimi-k2.5"
      - "kimi-k2"
    quota:
      limit: 1000
      period: "monthly"

  - name: "Claude"
    baseUrl: "https://api.anthropic.com"
    apiKey: "${ANTHROPIC_API_KEY}"
    models:
      - "claude-sonnet-4-6"
      - "claude-opus-4-6"
    quota:
      limit: 500
      period: "monthly"
```

### 4. Start the Gateway

```bash
npm start
```

### 5. Verify It Works

```bash
# Health check
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models

# Test chat completion
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Configure Claude Code

Set environment variable to use the gateway:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
```

Or add to Claude Code config:
```json
{
  "baseUrl": "http://localhost:8080"
}
```

---

## Configure Cursor/Other Tools

For OpenAI-compatible tools:
```bash
export OPENAI_BASE_URL=http://localhost:8080/v1
export OPENAI_API_KEY=dummy  # Gateway doesn't validate this
```

---

## Common Operations

### Add a New Plan

```bash
curl -X POST http://localhost:8080/api/plans \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Plan",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "your-api-key",
    "models": ["model-1", "model-2"],
    "quota": {"limit": 500, "period": "monthly"}
  }'
```

### Check Quota

```bash
curl http://localhost:8080/api/quota/{planId}
```

### Reset Quota

```bash
curl -X POST http://localhost:8080/api/quota/{planId}/reset
```

### Hot-Reload Configuration

```bash
npm run reload
```

---

## Docker Deployment

```bash
# Build
docker build -t coding-plan-gateway .

# Run
docker run -d \
  -p 8080:8080 \
  -v $(pwd)/config:/app/config \
  -e ENCRYPTION_KEY=your-key \
  coding-plan-gateway
```

---

## Troubleshooting

### "No coding plan supports model"

- Check that the model name matches exactly (case-sensitive)
- Verify the model is listed in a plan's `models` array

### "All coding plans exhausted"

- Check quota usage: `GET /api/quota/{planId}`
- Reset quota if needed: `POST /api/quota/{planId}/reset`

### "Upstream provider error"

- Verify API key is valid
- Check provider status page
- Review gateway logs for details

### "Configuration file corrupted"

- The gateway creates a backup before each write
- Restore from `config/plans.yaml.backup`
- Or start fresh with a new configuration

---

## Next Steps

1. Monitor quota usage with `GET /api/quota`
2. Add more coding plans as needed
3. Configure hot-reload for seamless updates
4. Set up monitoring via `/health` and `/ready` endpoints
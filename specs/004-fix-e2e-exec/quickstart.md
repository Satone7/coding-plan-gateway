# Quickstart: Fix E2E Claude Code Execution

**Feature**: 004-fix-e2e-exec
**Date**: 2026-03-24

## Prerequisites

- Docker installed and running
- Node.js 20+ LTS
- Valid API key for upstream provider (e.g., Kimi)

## Quick Verification

### 1. Configure Environment

```bash
# Copy example config and add your API key
cp e2e/test-config.example.yaml e2e/test-config.yaml
# Edit e2e/test-config.yaml with your API key
```

### 2. Start E2E Environment

```bash
npm run e2e:start
```

Expected output:
```
Building images...
Starting containers...
Gateway is healthy!
E2E environment is ready!
```

### 3. Test Claude Code Execution

```bash
# Non-interactive test
docker exec claude-code claude -p "Say hello in one word"
```

Expected: Claude responds with a greeting.

### 4. Test System Array Format

```bash
# Send request with system as array
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "kimi-k2.5",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 100,
    "system": [{"type": "text", "text": "Be concise"}]
  }'
```

Expected: Valid response, no validation error.

### 5. Stop Environment

```bash
npm run e2e:stop
```

## Verification Checklist

- [ ] E2E environment starts without errors
- [ ] `docker exec claude-code claude -p "hello"` returns a valid response
- [ ] Gateway accepts `system` as string format
- [ ] Gateway accepts `system` as array format
- [ ] Gateway forwards requests unchanged (transparent proxy)
- [ ] No "Not logged in" error from Claude Code
- [ ] No "Expected string, received array" validation error

## Troubleshooting

### "Not logged in" Error

**Cause**: Missing `ANTHROPIC_API_KEY` environment variable.

**Solution**: Check `docker-compose.e2e.yml` includes:
```yaml
environment:
  - ANTHROPIC_API_KEY=dummy-key-for-gateway
```

### "Expected string, received array" Error

**Cause**: Gateway validation schema only accepts string for `system` field.

**Solution**: This fix updates the schema to accept both string and array.

### Model Not Found Error

**Cause**: No coding plan configured for the requested model.

**Solution**: Check `e2e/test-config.yaml` includes the model in the plan's `models` list.

## Test Commands

```bash
# Check gateway health
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models

# View gateway logs
npm run e2e:logs

# Check container status
docker ps
```

## Success Criteria

| Test | Expected Result |
|------|-----------------|
| `docker exec claude-code claude -p "hello"` | Valid AI response |
| Request with system string | Accepted and processed |
| Request with system array | Accepted and processed |
| Empty system array | Treated as missing, no error |
| Unknown request fields | Passed through unchanged |
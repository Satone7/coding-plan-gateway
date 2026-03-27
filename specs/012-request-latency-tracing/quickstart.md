# Quickstart: Request Latency Tracing

**Feature**: 012-request-latency-tracing
**Date**: 2026-03-27

## Overview

Request latency tracing provides visibility into how long each processing stage takes for HTTP requests. This helps identify performance bottlenecks in the Gateway.

## What You'll See

When a request completes, you'll see a JSON log line like this:

```json
{
  "requestId": "req-abc123",
  "colorIndex": 2,
  "totalDurationMs": 125.45,
  "phases": [
    {"name": "requestReceived", "durationMs": 0.01},
    {"name": "validation", "durationMs": 2.34},
    {"name": "routing", "durationMs": 1.23},
    {"name": "quotaCheck", "durationMs": 0.45},
    {"name": "apiKeyDecryption", "durationMs": 15.67},
    {"name": "upstreamRequest", "durationMs": 100.12},
    {"name": "responseSent", "durationMs": 0.03}
  ],
  "incomplete": false
}
```

## Understanding the Output

| Field | Meaning |
|-------|---------|
| `requestId` | Unique ID for this request (use to filter logs) |
| `colorIndex` | ANSI color assigned (0-9) for terminal visualization |
| `totalDurationMs` | End-to-end request time |
| `phases` | Each processing stage with its duration |
| `incomplete` | `true` if request failed before completion |

## Visual Differentiation

In terminal output, each request's logs are colored differently:

```
[RED] req-abc123: validation 2.34ms, routing 1.23ms, ...
[GREEN] req-def456: validation 1.89ms, routing 0.98ms, ...
[YELLOW] req-ghi789: validation 3.12ms, routing 1.45ms, ...
```

## Identifying Bottlenecks

1. **High `upstreamRequest` time**: Provider is slow, consider failover
2. **High `apiKeyDecryption` time**: Decryption overhead significant
3. **High `routing` time**: Plan selection taking too long
4. **High `totalDurationMs` with low upstream**: Internal overhead issue

## Scope

Timing is tracked for:
- `/v1/chat/completions` (OpenAI format)
- `/v1/messages` (Anthropic format)
- `/api/*` (Admin API)

NOT tracked:
- `/health`, `/ready` (health checks)
- `/internal/*` (internal endpoints)

## Configuration

No configuration required — timing is automatically enabled for tracked endpoints.

## Log Filtering

Filter logs for a specific request:
```bash
grep '"requestId":"req-abc123"' gateway.log | jq .
```

Find slowest requests:
```bash
grep '"totalDurationMs"' gateway.log | jq -s 'sort_by(.totalDurationMs) | .[-5:]'
```
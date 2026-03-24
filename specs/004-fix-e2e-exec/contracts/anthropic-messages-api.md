# API Contract: Anthropic Messages Endpoint

**Feature**: 004-fix-e2e-exec
**Date**: 2026-03-24
**Version**: 1.1.0 (backward compatible extension)

## Endpoint

```
POST /v1/messages
```

## Request Schema

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| Content-Type | Yes | `application/json` |
| x-api-key | No | Ignored by gateway (uses configured keys) |
| anthropic-version | No | Passed through to upstream |

### Request Body

```json
{
  "model": "string (required)",
  "messages": "array (required, min 1)",
  "max_tokens": "integer (required, > 0)",
  "stream": "boolean (optional, default: false)",
  "system": "string | array (optional) ← MODIFIED",
  "temperature": "number (optional, 0-1)",
  "top_p": "number (optional, 0-1)",
  "top_k": "integer (optional, > 0)",
  "stop_sequences": "array of strings (optional)",
  "metadata": "object (optional)",
  "...additionalFields": "any (passed through unchanged)"
}
```

### System Field Formats

#### String Format (Original)

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 1024,
  "system": "You are a helpful assistant."
}
```

#### Array Format (New)

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 1024,
  "system": [
    {
      "type": "text",
      "text": "You are a helpful assistant."
    },
    {
      "type": "text",
      "text": "Additional context here.",
      "cache_control": {"type": "ephemeral"}
    }
  ]
}
```

#### Array with Image

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 1024,
  "system": [
    {
      "type": "text",
      "text": "You analyze images."
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "base64encoded..."
      }
    }
  ]
}
```

### Empty System Handling

| Input | Behavior |
|-------|----------|
| `system: ""` | Treated as missing, no system prompt |
| `system: []` | Treated as missing, no system prompt |
| `system` omitted | No system prompt |

## Response Schema

### Success Response (Non-Streaming)

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Response text..."
    }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  }
}
```

### Error Responses

#### Validation Error (400)

```json
{
  "error": {
    "message": "Validation failed",
    "type": "validation_error",
    "code": "INVALID_REQUEST"
  },
  "meta": {
    "requestId": "req-xxx",
    "timestamp": "2026-03-24T00:00:00.000Z"
  }
}
```

#### Model Not Found (404)

```json
{
  "error": {
    "message": "No coding plan supports model 'unknown-model'",
    "type": "model_not_found",
    "code": "MODEL_NOT_FOUND"
  },
  "meta": {
    "requestId": "req-xxx",
    "timestamp": "2026-03-24T00:00:00.000Z"
  }
}
```

## Pass-Through Behavior

The gateway preserves all request fields unchanged when forwarding to upstream providers:

1. **Validated fields**: `model`, `messages`, `max_tokens`, `stream`, `system`
2. **Known optional fields**: `temperature`, `top_p`, `top_k`, `stop_sequences`, `metadata`
3. **Unknown fields**: Passed through unchanged

### Example with Additional Fields

```json
{
  "model": "claude-sonnet-4-6",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 1024,
  "system": [{ "type": "text", "text": "Be helpful" }],
  "custom_field": "preserved",
  "experimental_option": { "any": "value" }
}
```

All fields are forwarded to upstream exactly as received.

## Compatibility

| Client Version | System String | System Array | Notes |
|----------------|---------------|--------------|-------|
| Claude Code 2.1.x | ✅ | ✅ | Full support |
| Claude Code 2.0.x | ✅ | ✅ | Uses string format |
| Custom clients | ✅ | ✅ | Both formats supported |

## Changes from v1.0.0

| Change | Type | Impact |
|--------|------|--------|
| `system` accepts array | Extension | Backward compatible |
| Empty arrays treated as missing | Addition | No breaking change |
| Additional fields passed through | Addition | No breaking change |
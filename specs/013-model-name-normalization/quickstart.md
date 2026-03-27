# Quickstart: Model Name Case-Insensitive Matching

**Feature Branch**: `013-model-name-normalization`
**Date**: 2026-03-27

## What This Feature Does

Enables flexible model name matching when routing AI requests through the gateway:

- **Case-insensitive matching**: `minimax-m2.5`, `MiniMax-M2.5`, `MINIMAX-M2.5` all match the same model
- **Model aliases**: `gpt-4` automatically resolves to `gpt-4-turbo`
- **Clear errors**: When a model is not found, the error message lists available models
- **Original names preserved**: Upstream providers receive the original model name from your request

## Verification

### Before Implementation (Current Behavior)

```bash
# These should already work (case-insensitive):
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "minimax-m2.5", "messages": [{"role": "user", "content": "test"}]}'

# This would fail because only "MiniMax-M2.5" is configured
```

### After Implementation

```bash
# All of these work:
# 1. Lowercase
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "minimax-m2.5", "messages": [{"role": "user", "content": "test"}]}'

# 2. Uppercase
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "MINIMAX-M2.5", "messages": [{"role": "user", "content": "test"}]}'

# 3. Title case (as configured)
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "MiniMax-M2.5", "messages": [{"role": "user", "content": "test"}]}'

# 4. Aliases work
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "test"}]}'
# -> Routes to gpt-4-turbo plan, but sends "gpt-4" to upstream
```

### Error Message Improvement

```json
{
  "error": {
    "message": "Model 'unknown-model' not found. Case-insensitive search performed. Available models: gpt-4-turbo, claude-3-opus-20240229, minimax-m2.5, ...",
    "type": "invalid_request_error",
    "code": "MODEL_NOT_FOUND"
  }
}
```

## Implementation Checklist

- [ ] Create `src/services/model-resolver.ts` with alias resolution
- [ ] Update `src/services/plan-selector.ts` to use ModelResolver
- [ ] Update `src/services/request-router.ts` to use ModelResolver
- [ ] Update error handling to include available models
- [ ] Add unit tests for ModelResolver
- [ ] Run existing integration tests to verify backward compatibility
- [ ] Verify upstream receives original model name

## Testing

### Unit Tests

```bash
npm test -- --grep "ModelResolver"
```

### Integration Tests

```bash
# Test case-insensitive routing
npm run test:integration -- --test-case="case-insensitive-model"

# Test alias resolution
npm run test:integration -- --test-case="model-alias"
```

### Manual Testing

```bash
# Start server
npm start

# Test various case variations
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4-turbo", "messages": [{"role": "user", "content": "test"}]}'
```

## Configuration

No configuration changes required. Existing plans work without modification.

## Troubleshooting

### Model Not Found

If you get a model not found error:

1. Check available models: `GET /v1/models`
2. Verify your plan configuration has the model listed
3. Try the exact model name from `/v1/models`

### Alias Not Working

Built-in aliases include common variations. For custom aliases, the implementation provides an extensible pattern for adding new aliases.

## See Also

- [spec.md](./spec.md) - Feature specification
- [research.md](./research.md) - Implementation research
- [data-model.md](./data-model.md) - Data structures
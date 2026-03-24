# Quick Start: API Key Management

This guide covers the API key management feature for Coding Plan Gateway.

## Prerequisites

- Node.js 20+ LTS
- Coding Plan Gateway installed
- `ENCRYPTION_KEY` environment variable set

## Quick Commands

### Create an API Key

```bash
npm run key:create -- --name "My Development Key"
```

Output:
```
API Key created successfully!

  ID: 550e8400-e29b-41d4-a716-446655440000
  Name: My Development Key
  Key: cpg_abc123def456ghi789jkl012mno345pqr

IMPORTANT: Save this key now! It will not be shown again.
```

### List All Keys

```bash
npm run key:list
```

Output:
```
API Keys:
  ID                                    Name              Status   Prefix     Created
  550e8400-e29b-41d4-a716-446655440000 My Development Key active  abc12345   2026-03-24
```

### Use an API Key

Include the key in the Authorization header:

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer cpg_abc123def456ghi789jkl012mno345pqr" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Disable a Key

```bash
npm run key:disable -- --id 550e8400-e29b-41d4-a716-446655440000
```

### Enable a Key

```bash
npm run key:enable -- --id 550e8400-e29b-41d4-a716-446655440000
```

### Delete a Key

```bash
npm run key:delete -- --id 550e8400-e29b-41d4-a716-446655440000
```

### View Usage Report

```bash
# All keys, all time
npm run usage:report

# Specific key
npm run usage:report -- --key-id 550e8400-e29b-41d4-a716-446655440000

# Date range
npm run usage:report -- --from 2026-01-01 --to 2026-03-31
```

## Error Responses

### Invalid API Key (401 Unauthorized)

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}
```

### Disabled API Key (403 Forbidden)

```json
{
  "error": {
    "message": "API key is disabled",
    "type": "authentication_error",
    "code": "api_key_disabled"
  }
}
```

### Missing Authorization (401 Unauthorized)

```json
{
  "error": {
    "message": "Missing Authorization header",
    "type": "authentication_error",
    "code": "missing_auth_header"
  }
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS_PATH` | `./api-keys.json` | Path to API keys storage |
| `USAGE_DATA_PATH` | `./usage-data.json` | Path to usage data |
| `AUTH_EXEMPT_PATHS` | (empty) | Comma-separated exempt paths |
| `USAGE_SYNC_INTERVAL` | `60000` | Usage sync interval (ms) |

### Exempting Paths from Authentication

To allow unauthenticated access to certain endpoints:

```bash
export AUTH_EXEMPT_PATHS="/health,/ready,/api/public"
```

## File Locations

- **API Keys**: `./api-keys.json` (configurable via `API_KEYS_PATH`)
- **Usage Data**: `./usage-data.json` (configurable via `USAGE_DATA_PATH`)

## Security Notes

1. **Key Storage**: API keys are stored as bcrypt hashes. The full key is only shown once during creation.
2. **Key Format**: Keys use the prefix `cpg_` followed by 32 random alphanumeric characters.
3. **Identification**: Keys are identified by their first 8 characters after the prefix (displayed in `key:list`).
4. **Expiration**: Keys can have an optional expiration date set during creation.

## Common Workflows

### Rotating an API Key

1. Create a new key: `npm run key:create -- --name "New Key"`
2. Update your application to use the new key
3. Disable the old key: `npm run key:disable -- --id <old-key-id>`
4. Verify new key works, then delete old key: `npm run key:delete -- --id <old-key-id>`

### Setting Up a New Environment

1. Create a key for each service/integration:
   ```bash
   npm run key:create -- --name "Claude Code"
   npm run key:create -- --name "Cursor IDE"
   npm run key:create -- --name "CI/CD Pipeline"
   ```
2. Configure each tool with its respective key
3. Monitor usage with `npm run usage:report`
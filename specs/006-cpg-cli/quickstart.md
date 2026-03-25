# Quickstart: CPG CLI Executable

This guide covers using the `cpg` CLI for gateway management.

## Installation

The `cpg` CLI is included in the Docker image and available locally after building.

### Local Development

```bash
# Build the project
npm run build

# Run CLI directly
node bin/cpg --help
```

### Docker Container

```bash
# CLI is available in running containers
docker exec gateway cpg --help
```

## Basic Usage

### View Help

```bash
cpg --help
cpg key --help
cpg key create --help
```

### View Version

```bash
cpg --version
```

## API Key Management

### Create an API Key

```bash
# Basic creation
cpg key create --name "My API Key"

# With expiration date
cpg key create --name "Production Key" --expires 2026-12-31

# JSON output for scripting
cpg key create --name "Automation Key" --json
```

### List API Keys

```bash
# Human-readable table
cpg key list

# JSON format
cpg key list --json
```

### Test API Key Validity

```bash
# Test a key
cpg key test cpg_1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# JSON output
cpg key test cpg_xxxx... --json
```

### Disable/Enable Keys

```bash
# Disable a key
cpg key disable --id 550e8400-e29b-41d4-a716-446655440000

# Re-enable a key
cpg key enable --id 550e8400-e29b-41d4-a716-446655440000
```

### Delete Keys

```bash
# Permanently delete a key
cpg key delete --id 550e8400-e29b-41d4-a716-446655440000
```

## Usage Reporting

```bash
# Full usage report
cpg usage-report

# Filter by key
cpg usage-report --key-id 550e8400-e29b-41d4-a716-446655440000

# Date range
cpg usage-report --from 2026-03-01 --to 2026-03-31

# JSON output
cpg usage-report --json
```

## Docker Integration

### Running in Container

```bash
# Create key in running container
docker exec gateway cpg key create --name "Docker Key"

# Key is immediately available for authentication
docker exec gateway cpg key list
```

### Real-time Key Availability

Keys created via CLI are immediately available:

```bash
# Create key
docker exec gateway cpg key create --name "Test Key" --json

# Use key immediately
curl -H "Authorization: Bearer cpg_xxx..." http://localhost:8080/v1/models
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GATEWAY_URL` | Gateway URL for notifications (default: http://localhost:8080) |
| `CONFIG_PATH` | Config directory path |
| `ENCRYPTION_KEY` | Required for key operations |

## JSON Output Format

All commands support `--json` flag for machine-readable output:

```bash
cpg key create --name "Test" --json | jq '.key.id'
```

## Common Patterns

### Automation Script

```bash
#!/bin/bash
# Create key and extract ID
KEY_ID=$(cpg key create --name "CI Key" --json | jq -r '.key.id')
echo "Created key: $KEY_ID"

# Use key for testing
API_KEY=$(cpg key create --name "Test" --json | jq -r '.key.plaintextKey')

# Run tests with key
TEST_API_KEY="$API_KEY" npm test

# Cleanup
cpg key delete --id "$KEY_ID"
```

### Docker Compose Integration

```yaml
# docker-compose.yml
services:
  gateway:
    image: coding-plan-gateway
    # ... other config

  # Run CLI commands in gateway container
  cli:
    image: coding-plan-gateway
    command: ["cpg", "key", "list"]
    depends_on:
      - gateway
```

## Troubleshooting

### Key Not Working After Creation

The CLI notifies the gateway automatically. If issues persist:

```bash
# Check gateway is running
curl http://localhost:8080/health

# Verify key status
cpg key test cpg_xxx...
```

### Missing ENCRYPTION_KEY

```bash
# Set environment variable
export ENCRYPTION_KEY="your-32-byte-key"
cpg key create --name "Test"
```

### Gateway Unreachable

```bash
# Specify gateway URL
cpg key create --name "Test" --gateway-url http://localhost:8080

# Or via environment
export GATEWAY_URL=http://localhost:8080
```
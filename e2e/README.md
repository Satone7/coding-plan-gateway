# E2E Docker Testing Environment

This directory contains the end-to-end testing infrastructure for the Coding Plan Gateway.

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

- `baseUrl`: Upstream provider API endpoint
- `apiKey`: Your API key for authentication
- `models`: List of supported model names
- `quota`: Request limits and tracking

## Environment Variables

Claude Code is configured via environment variables in `docker-compose.e2e.yml`:

- `ANTHROPIC_BASE_URL`: Gateway endpoint (http://gateway:8080)
- `ANTHROPIC_MODEL`: Default model (kimi-k2.5)

## Logs

Logs are captured in the `logs/` directory at repository root:

- `logs/gateway/`: Gateway service logs
- `logs/claude-code/`: Claude Code container logs

## Troubleshooting

### Container won't start
- Check Docker is running: `docker info`
- Verify config exists: `ls e2e/test-config.yaml`

### Gateway not accessible
- Check container status: `npm run e2e:status`
- View logs: `npm run e2e:logs`

### API key errors
- Verify API key in `test-config.yaml`
- Check key is valid with your provider
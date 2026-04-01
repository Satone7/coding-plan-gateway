# Coding Plan Gateway

A load balancer for managing multiple AI coding plan subscriptions. Routes requests to appropriate providers based on model availability and quota, exposing OpenAI and Anthropic compatible APIs.

## Features

- **Multi-provider support**: Manage multiple AI coding plans (Kimi, Claude, OpenAI, etc.)
- **Dual API compatibility**: Exposes both OpenAI and Anthropic compatible endpoints
- **Intelligent routing**: Automatically selects plans based on model availability and quota
- **Quota management**: Track and prioritize usage across plans
- **Circuit breaker**: Automatic failover when providers fail
- **Streaming support**: Full SSE streaming for chat completions
- **CLI tool**: Built-in `cpg` command-line tool for API key management, usage reports, and TUI dashboard
- **TUI Dashboard**: Real-time terminal UI for monitoring active requests, plan usage, and gateway latency

## Quick Start

### Prerequisites

- Node.js 20+ LTS
- npm or yarn
- At least one AI provider API key

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd coding-plan-gateway

# Install dependencies
npm install

# Initialize configuration files
./init.sh

# Set your API keys in config.yaml
# (Open config.yaml and replace placeholders with actual keys)

# Build and start
npm run build
npm start
```

### Verify Installation

```bash
# Health check
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/api/v1/models
```

## API Reference

### OpenAI Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Create chat completion (streaming supported) |
| `/api/v1/models` | GET | List available models |

### Anthropic Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | POST | Create message (streaming supported) |

### Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/plans` | GET | List all coding plans |
| `/api/plans` | POST | Create a new plan |
| `/api/plans/:planId` | GET | Get plan details |
| `/api/plans/:planId` | PUT | Update a plan |
| `/api/plans/:planId` | DELETE | Delete a plan |
| `/api/quota/:planId` | GET | Get quota status |
| `/api/quota/:planId/reset` | POST | Reset quota |
| `/api/internal/reload` | POST | Hot reload plans configuration |

### Health Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness probe |
| `/ready` | GET | Readiness probe |

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | Yes | - | 32-byte hex key for API key encryption |
| `PORT` | No | `8080` | Server port |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |
| `NODE_ENV` | No | `development` | Environment (development, production) |
| `CONFIG_PATH` | No | `./config.yaml` | Path to plans config file |
| `IPC_SOCKET_PATH` | No | `/tmp/coding-plan-gateway.sock` | Path for IPC dashboard socket |

### Plan Configuration

Plans are configured in `config.yaml` (copied from `config.yaml.example` during initialization):

```yaml
plans:
  - name: "Plan Name"
    baseUrl: "https://api.provider.com/v1"
    apiKey: "${ENV_VAR}"  # Environment variable reference
    models:
      - "model-1"
      - "model-2"
    quota:
      limit: 1000        # Maximum requests
      period: "monthly"  # daily, monthly, or total
    timeout: 30000       # Request timeout in ms (optional)
    status: "active"     # active or paused (optional)
```

## Usage Examples

### Configure Claude Code

```bash
export ANTHROPIC_BASE_URL=http://localhost:8080
```

### Configure Cursor/OpenAI-compatible Tools

```bash
export OPENAI_BASE_URL=http://localhost:8080/v1
export OPENAI_API_KEY=dummy  # Gateway doesn't validate this
```

### Chat Completion Example

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Add a New Plan

```bash
curl -X POST http://localhost:8080/api/plans \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Kimi",
    "baseUrl": "https://api.moonshot.cn/v1",
    "apiKey": "your-kimi-api-key",
    "models": ["kimi-k2.5"],
    "quota": {"limit": 1000, "period": "monthly"}
  }'
```

## Docker Deployment

### Build and Run

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run

# Or use docker-compose
docker-compose up -d
```

### Development with Hot Reload

```bash
docker-compose --profile dev up gateway-dev
```

## Development

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and TUI Dashboard |
| `npm start` | Run production build |
| `npm run dev` | Run with ts-node |
| `npm run dashboard` | Launch the TUI Dashboard |
| `npm test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Lint code |
| `npm run typecheck` | Type check |

### Project Structure

```
src/
├── index.ts              # Entry point
├── app.ts                # Fastify app factory
├── config/               # Configuration management
├── routes/               # API endpoints
│   ├── openai/           # OpenAI-compatible routes
│   ├── anthropic/        # Anthropic-compatible routes
│   ├── admin/            # Plan management routes
│   ├── internal/         # Internal system endpoints
│   └── health/           # Health check routes
├── services/             # Business logic
├── middleware/           # Request/response middleware
├── dashboard/            # Ink-based TUI Dashboard
├── cli/                  # Command-line interface
├── types/                # TypeScript types
└── utils/                # Utilities
```

## Architecture

The gateway follows a service-oriented architecture:

1. **Request Router** - Routes requests to appropriate plans based on model availability
2. **Plan Selector** - Selects the best plan based on quota and circuit breaker state
3. **Request Proxy** - Forwards requests to upstream providers
4. **Circuit Breaker** - Handles provider failures with automatic recovery
5. **Quota Manager** - Tracks and persists quota usage

## Security

- API keys are encrypted at rest using AES-256-GCM
- All inputs validated with Zod schemas
- No secrets in logs or error messages
- Environment variables for sensitive configuration

## CLI Usage

The `cpg` command-line tool provides API key management, usage reporting, and a TUI dashboard.

### Installation

```bash
# Build the project
npm run build

# Run CLI
node bin/cpg --help

# Or via npm script
npm run cpg -- --help
```

### Commands

#### TUI Dashboard

```bash
# Launch the real-time TUI dashboard
cpg dashboard
```

#### API Key Management

```bash
# Create a new API key
cpg key create --name "My Key"
cpg key create --name "Production Key" --expires 2026-12-31

# List all keys
cpg key list
cpg key list --json

# Test a key
cpg key test cpg_xxxxxxxx...

# Disable/Enable keys
cpg key disable --id <uuid>
cpg key enable --id <uuid>

# Delete a key
cpg key delete --id <uuid>
```

#### Usage Reporting

```bash
# Show usage report
cpg usage-report

# Filter by key and date range
cpg usage-report --key-id <uuid> --from 2026-03-01 --to 2026-03-31

# JSON output
cpg usage-report --json
```

#### Plan Management

```bash
# List all plans with usage summary
cpg plan list

# Set usage for a plan manually
cpg plan set-usage --id 1 --count 100
```

### Docker Usage

The CLI is available in Docker containers:

```bash
# Run CLI in gateway container
docker exec gateway cpg key list

# Create a key
docker exec gateway cpg key create --name "Docker Key"
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error (missing ENCRYPTION_KEY) |
| 3 | Network error |
| 4 | Storage error |

## License

MIT
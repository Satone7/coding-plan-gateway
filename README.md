# Coding Plan Gateway

A load balancer for managing multiple AI coding plan subscriptions. Routes requests to appropriate providers based on model availability and quota, exposing OpenAI and Anthropic compatible APIs.

## Features

- **Multi-provider support**: Manage multiple AI coding plans (Kimi, Claude, OpenAI, etc.)
- **Dual API compatibility**: Exposes both OpenAI and Anthropic compatible endpoints
- **Intelligent routing**: Automatically selects plans based on model availability and quota
- **Quota management**: Track and prioritize usage across plans
- **Circuit breaker**: Automatic failover when providers fail
- **Streaming support**: Full SSE streaming for chat completions

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

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Create .env file
cat > .env << EOF
ENCRYPTION_KEY=your-generated-key-here
PORT=8080
LOG_LEVEL=info
EOF

# Create initial configuration
mkdir -p config
cat > config/plans.yaml << EOF
plans:
  - name: "Claude"
    baseUrl: "https://api.anthropic.com"
    apiKey: "\${ANTHROPIC_API_KEY}"
    models:
      - "claude-sonnet-4-6"
      - "claude-opus-4-6"
    quota:
      limit: 500
      period: "monthly"
EOF

# Set your API key
export ANTHROPIC_API_KEY=your-api-key

# Build and start
npm run build
npm start
```

### Verify Installation

```bash
# Health check
curl http://localhost:8080/health

# List available models
curl http://localhost:8080/v1/models
```

## API Reference

### OpenAI Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Create chat completion (streaming supported) |
| `/v1/models` | GET | List available models |

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

### Plan Configuration

Plans are configured in `config/plans.yaml`:

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
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm run dev` | Run with ts-node |
| `npm run dev:watch` | Run with hot reload |
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
│   └── health/           # Health check routes
├── services/             # Business logic
├── middleware/           # Request/response middleware
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

## License

MIT
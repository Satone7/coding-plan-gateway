#!/bin/bash
# Start the E2E testing environment
# Usage: npm run e2e:start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.e2e.yml"
RUNTIME_ENV_FILE="$PROJECT_ROOT/e2e/runtime/e2e.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting E2E environment...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon not running. Please start Docker and try again.${NC}"
    exit 1
fi

# Check if .env exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${RED}Error: .env not found.${NC}"
    echo -e "${YELLOW}Copy .env.example and configure at least one provider API key:${NC}"
    echo "  cp .env.example .env"
    exit 2
fi

# Generate runtime E2E files
echo "Preparing generated E2E config..."
if ! npx ts-node "$PROJECT_ROOT/scripts/e2e/prepare.ts"; then
    echo -e "${RED}Error: Failed to prepare E2E runtime files.${NC}"
    exit 3
fi

set -a
# shellcheck disable=SC1091
source "$PROJECT_ROOT/.env"
if [ -f "$RUNTIME_ENV_FILE" ]; then
    # shellcheck disable=SC1091
    source "$RUNTIME_ENV_FILE"
fi
set +a

if [ -z "${E2E_ENCRYPTION_KEY:-}" ] && [ -n "${ENCRYPTION_KEY:-}" ]; then
    export E2E_ENCRYPTION_KEY="$ENCRYPTION_KEY"
fi

if [ -z "${E2E_ENCRYPTION_KEY:-}" ]; then
    echo -e "${RED}Error: E2E_ENCRYPTION_KEY or ENCRYPTION_KEY must be set in .env.${NC}"
    exit 3
fi

# Build images
echo "Building images..."
if ! docker compose -f "$COMPOSE_FILE" build; then
    echo -e "${RED}Error: Failed to build images. Check Docker logs for details.${NC}"
    exit 4
fi

# Start containers
echo "Starting containers..."
if ! docker compose -f "$COMPOSE_FILE" up -d; then
    echo -e "${RED}Error: Failed to start containers.${NC}"
    exit 5
fi

# Wait for gateway to be healthy
echo "Waiting for gateway to be healthy..."
MAX_WAIT=60
WAITED=0
GATEWAY_PORT="${E2E_GATEWAY_PORT:-8081}"
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s "http://localhost:${GATEWAY_PORT}/health" > /dev/null 2>&1; then
        echo -e "${GREEN}Gateway is healthy!${NC}"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo "  Waiting... ($WAITED seconds)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}Error: Gateway failed to start within 60 seconds.${NC}"
    echo "Check docker compose logs for details."
    exit 6
fi

# Verify CLI is available
echo "Verifying CLI availability..."
if docker exec gateway-e2e cpg --version > /dev/null 2>&1; then
    CLI_VERSION=$(docker exec gateway-e2e cpg --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}CLI is available: $CLI_VERSION${NC}"
else
    echo -e "${YELLOW}Warning: CLI not available in container. Some features may not work.${NC}"
fi

echo ""
echo -e "${GREEN}E2E environment is ready!${NC}"
echo ""
echo "Gateway:     http://localhost:${GATEWAY_PORT}"
echo "Health:      http://localhost:${GATEWAY_PORT}/health"
echo "Models:      http://localhost:${GATEWAY_PORT}/v1/models"
echo ""
echo "CLI Commands:"
echo "  docker exec gateway-e2e cpg --help"
echo "  docker exec gateway-e2e cpg key create --name \"Test Key\" --json"
echo "  docker exec gateway-e2e cpg key list --json"
echo ""
echo "Run Claude Code:"
echo "  docker exec -it claude-code-e2e claude"
echo "  docker exec -it claude-code-e2e env ANTHROPIC_API_KEY=<gateway-key> ANTHROPIC_BASE_URL=http://gateway-e2e:8080/api claude -p \"Say hello in one word\""
echo ""
echo "View logs:"
echo "  npm run e2e:logs"

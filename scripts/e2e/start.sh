#!/bin/bash
# Start the E2E testing environment
# Usage: npm run e2e:start

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.e2e.yml"

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

# Check if config file exists
if [ ! -f "$PROJECT_ROOT/e2e/test-config.yaml" ]; then
    echo -e "${RED}Error: test-config.yaml not found.${NC}"
    echo -e "${YELLOW}Copy test-config.example.yaml and configure your API keys:${NC}"
    echo "  cp e2e/test-config.example.yaml e2e/test-config.yaml"
    exit 2
fi

# Build images
echo "Building images..."
if ! docker-compose -f "$COMPOSE_FILE" build; then
    echo -e "${RED}Error: Failed to build images. Check Docker logs for details.${NC}"
    exit 3
fi

# Start containers
echo "Starting containers..."
if ! docker-compose -f "$COMPOSE_FILE" up -d; then
    echo -e "${RED}Error: Failed to start containers.${NC}"
    exit 4
fi

# Wait for gateway to be healthy
echo "Waiting for gateway to be healthy..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}Gateway is healthy!${NC}"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo "  Waiting... ($WAITED seconds)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}Error: Gateway failed to start within 60 seconds.${NC}"
    echo "Check logs/gateway/ for details."
    exit 4
fi

echo ""
echo -e "${GREEN}E2E environment is ready!${NC}"
echo ""
echo "Gateway:     http://localhost:8080"
echo "Health:      http://localhost:8080/health"
echo "Models:      http://localhost:8080/v1/models"
echo ""
echo "Run Claude Code:"
echo "  docker exec -it claude-code claude"
echo ""
echo "View logs:"
echo "  npm run e2e:logs"
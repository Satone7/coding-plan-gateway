#!/bin/bash
# Reset the E2E testing environment
# Stops containers, removes containers, removes volumes, rebuilds images
# Usage: npm run e2e:reset

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.e2e.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Resetting E2E environment...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon not running.${NC}"
    exit 1
fi

# Stop containers
echo "Stopping containers..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

# Remove volumes
echo "Removing volumes..."
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true

# Remove images (optional - uncomment if needed)
# echo "Removing images..."
# docker rmi coding-plan-gateway:test 2>/dev/null || true
# docker rmi e2e-claude-code 2>/dev/null || true

# Rebuild images
echo "Rebuilding images..."
if ! docker compose -f "$COMPOSE_FILE" build --no-cache; then
    echo -e "${RED}Error: Failed to rebuild images.${NC}"
    exit 2
fi

echo ""
echo -e "${GREEN}E2E environment reset complete.${NC}"
echo ""
echo "To start fresh:"
echo "  npm run e2e:start"

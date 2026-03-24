#!/bin/bash
# Stop the E2E testing environment
# Usage: npm run e2e:stop

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.e2e.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "Stopping E2E environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker daemon not running.${NC}"
    exit 1
fi

# Stop containers
docker-compose -f "$COMPOSE_FILE" stop

echo -e "${GREEN}E2E environment stopped.${NC}"
echo ""
echo "To restart:"
echo "  npm run e2e:start"
echo ""
echo "To completely remove containers:"
echo "  npm run e2e:reset"
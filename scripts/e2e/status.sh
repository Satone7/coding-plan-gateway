#!/bin/bash
# Check status of the E2E testing environment
# Usage: npm run e2e:status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.e2e.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "E2E Environment Status:"
echo "======================="
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo -e "Docker:      ${RED}not running${NC}"
    exit 2
fi

echo -e "Docker:      ${GREEN}running${NC}"
echo ""

# Check containers
GATEWAY_STATUS=$(docker ps -a --filter "name=gateway" --format "{{.Status}}" 2>/dev/null || echo "")
CLAUDE_STATUS=$(docker ps -a --filter "name=claude-code" --format "{{.Status}}" 2>/dev/null || echo "")

if [ -z "$GATEWAY_STATUS" ]; then
    echo -e "Gateway:     ${YELLOW}not created${NC}"
else
    if echo "$GATEWAY_STATUS" | grep -q "^Up"; then
        echo -e "Gateway:     ${GREEN}$GATEWAY_STATUS${NC}"
    else
        echo -e "Gateway:     ${YELLOW}$GATEWAY_STATUS${NC}"
    fi
fi

if [ -z "$CLAUDE_STATUS" ]; then
    echo -e "Claude Code: ${YELLOW}not created${NC}"
else
    if echo "$CLAUDE_STATUS" | grep -q "^Up"; then
        echo -e "Claude Code: ${GREEN}$CLAUDE_STATUS${NC}"
    else
        echo -e "Claude Code: ${YELLOW}$CLAUDE_STATUS${NC}"
    fi
fi
echo ""

# Check config
if [ -f "$PROJECT_ROOT/e2e/test-config.yaml" ]; then
    echo -e "Config:      ${GREEN}valid${NC}"
else
    echo -e "Config:      ${RED}missing${NC}"
    echo "             Copy e2e/test-config.example.yaml to e2e/test-config.yaml and chmod 666 e2e/test-config.yaml"
fi

# Check logs directory
if [ -d "$PROJECT_ROOT/logs" ]; then
    echo "Logs:        $PROJECT_ROOT/logs/"
else
    echo -e "Logs:        ${YELLOW}not created${NC}"
fi

echo ""

# Check gateway health if running
if echo "$GATEWAY_STATUS" | grep -q "^Up"; then
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "Health:      ${GREEN}OK${NC}"
    else
        echo -e "Health:      ${RED}failing${NC}"
    fi
fi

# Exit code
if echo "$GATEWAY_STATUS" | grep -q "^Up" && echo "$CLAUDE_STATUS" | grep -q "^Up"; then
    exit 0
else
    exit 1
fi
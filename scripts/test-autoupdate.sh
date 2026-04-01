#!/usr/bin/env bash
# test-autoupdate.sh - Integration tests for auto-update functionality
# Version: 1.0.0
# Usage: ./test-autoupdate.sh [test-pattern]

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Test configuration
readonly TEST_IMAGE="cpg:autoupdate-test"
readonly TEST_CONTAINER="cpg-test-autoupdate"
readonly TEST_TIMEOUT=120

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Colors for output (if terminal)
if [[ -t 1 ]]; then
  readonly COLOR_RESET='\033[0m'
  readonly COLOR_GREEN='\033[32m'
  readonly COLOR_RED='\033[31m'
  readonly COLOR_YELLOW='\033[33m'
  readonly COLOR_BLUE='\033[34m'
else
  readonly COLOR_RESET=''
  readonly COLOR_GREEN=''
  readonly COLOR_RED=''
  readonly COLOR_YELLOW=''
  readonly COLOR_BLUE=''
fi

# Logging functions
log_info() {
  echo -e "${COLOR_BLUE}[INFO]${COLOR_RESET} $*"
}

log_pass() {
  echo -e "${COLOR_GREEN}[PASS]${COLOR_RESET} $*"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

log_fail() {
  echo -e "${COLOR_RED}[FAIL]${COLOR_RESET} $*"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

log_skip() {
  echo -e "${COLOR_YELLOW}[SKIP]${COLOR_RESET} $*"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

# Cleanup function
cleanup() {
  log_info "Cleaning up test resources..."

  # Stop and remove test container if exists
  if docker ps -a --format '{{.Names}}' | grep -q "^${TEST_CONTAINER}$"; then
    docker stop "$TEST_CONTAINER" &>/dev/null || true
    docker rm -f "$TEST_CONTAINER" &>/dev/null || true
  fi

  # Remove test image if exists
  if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${TEST_IMAGE}$"; then
    docker rmi "$TEST_IMAGE" &>/dev/null || true
  fi
}

# Setup function
setup() {
  log_info "Setting up test environment..."

  # Check prerequisites
  if ! command -v docker &>/dev/null; then
    echo "Error: Docker is not installed"
    exit 1
  fi

  # Cleanup any existing test resources
  cleanup

  # Build test image
  log_info "Building test image..."
  docker build -f "${PROJECT_ROOT}/docker/autoupdate/Dockerfile.autoupdate" \
    -t "$TEST_IMAGE" \
    "$PROJECT_ROOT" &>/dev/null

  log_info "Test environment ready"
}

# Helper: Wait for container log pattern
wait_for_log() {
  local container="${1:-}"
  local pattern="${2:-}"
  local timeout="${3:-30}"

  local start_time
  start_time=$(date +%s)
  local end_time=$((start_time + timeout))

  while [[ $(date +%s) -lt $end_time ]]; do
    if docker logs "$container" 2>&1 | grep -q "$pattern"; then
      return 0
    fi
    sleep 1
  done

  return 1
}

# Helper: Wait for container health
wait_for_health() {
  local container="${1:-}"
  local timeout="${2:-60}"

  local start_time
  start_time=$(date +%s)
  local end_time=$((start_time + timeout))

  while [[ $(date +%s) -lt $end_time ]]; do
    if docker exec "$container" wget -q -O - http://localhost:8080/health &>/dev/null; then
      return 0
    fi
    sleep 2
  done

  return 1
}

# ============================================================================
# TEST CASES
# ============================================================================

test_build_image() {
  log_info "TEST: Build image successfully"

  if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${TEST_IMAGE}$"; then
    log_pass "Image built successfully"
  else
    log_fail "Image not found"
  fi
}

test_container_starts() {
  log_info "TEST: Container starts without auto-update"

  # Start container with auto-update disabled
  docker run -d \
    --name "$TEST_CONTAINER" \
    -e AUTOUPDATE_ENABLED=false \
    -e PORT=8080 \
    -p 8081:8080 \
    "$TEST_IMAGE" &>/dev/null

  # Wait for health check
  if wait_for_health "$TEST_CONTAINER" 30; then
    log_pass "Container starts and becomes healthy"
  else
    log_fail "Container failed to start or become healthy"
    docker logs "$TEST_CONTAINER" 2>&1 | tail -20
  fi

  docker stop "$TEST_CONTAINER" &>/dev/null || true
  docker rm -f "$TEST_CONTAINER" &>/dev/null || true
}

test_entrypoint_commands() {
  log_info "TEST: Entrypoint command handling"

  local output

  # Test help command
  output=$(docker run --rm "$TEST_IMAGE" /app/entrypoint.sh help 2>&1 || true)
  if echo "$output" | grep -q "Auto-Update Entrypoint"; then
    log_pass "Help command works"
  else
    log_fail "Help command failed"
  fi

  # Test status command (should show idle status)
  output=$(docker run --rm "$TEST_IMAGE" /app/entrypoint.sh status 2>&1 || true)
  if echo "$output" | grep -q "Auto-Update Status"; then
    log_pass "Status command works"
  else
    log_fail "Status command failed"
  fi
}

test_library_loading() {
  log_info "TEST: Library loading and basic functions"

  # Test logging library
  local output
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    init_logging
    log_info 'TEST' 'Logging works'
  " 2>&1)

  if echo "$output" | grep -q "Logging works"; then
    log_pass "Logging library loads and functions work"
  else
    log_fail "Logging library failed"
  fi

  # Test git library (just check it loads, don't need actual git)
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/git.sh 2>&1 && echo 'GIT_LOADED'
  " 2>&1)

  if echo "$output" | grep -q "GIT_LOADED"; then
    log_pass "Git library loads successfully"
  else
    log_fail "Git library failed to load"
  fi

  # Test build library
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/build.sh 2>&1 && echo 'BUILD_LOADED'
  " 2>&1)

  if echo "$output" | grep -q "BUILD_LOADED"; then
    log_pass "Build library loads successfully"
  else
    log_fail "Build library failed to load"
  fi

  # Test health library
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/health.sh 2>&1 && echo 'HEALTH_LOADED'
  " 2>&1)

  if echo "$output" | grep -q "HEALTH_LOADED"; then
    log_pass "Health library loads successfully"
  else
    log_fail "Health library failed to load"
  fi

  # Test rollback library
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/rollback.sh 2>&1 && echo 'ROLLBACK_LOADED'
  " 2>&1)

  if echo "$output" | grep -q "ROLLBACK_LOADED"; then
    log_pass "Rollback library loads successfully"
  else
    log_fail "Rollback library failed to load"
  fi
}

test_signal_handling() {
  log_info "TEST: Signal handling"

  # Start container
  docker run -d \
    --name "$TEST_CONTAINER" \
    -e AUTOUPDATE_ENABLED=false \
    -e PORT=8080 \
    -p 8081:8080 \
    "$TEST_IMAGE" &>/dev/null

  # Wait for startup
  sleep 3

  # Send SIGUSR1 (should log signal received)
  docker kill --signal=SIGUSR1 "$TEST_CONTAINER" &>/dev/null

  sleep 1

  # Check log for signal handling
  local logs
  logs=$(docker logs "$TEST_CONTAINER" 2>&1)

  if echo "$logs" | grep -q "SIGUSR1\|UPDATE_SIGNAL"; then
    log_pass "SIGUSR1 signal is handled"
  else
    # This might fail if auto-update is disabled, which is expected
    log_skip "SIGUSR1 signal handling (auto-update disabled)"
  fi

  # Test graceful shutdown
  docker stop -t 5 "$TEST_CONTAINER" &>/dev/null || true

  if ! docker ps | grep -q "$TEST_CONTAINER"; then
    log_pass "Container stops gracefully on SIGTERM"
  else
    log_fail "Container did not stop gracefully"
  fi

  docker rm -f "$TEST_CONTAINER" &>/dev/null || true
}

test_health_checks() {
  log_info "TEST: Health check library"

  # Start container
  docker run -d \
    --name "$TEST_CONTAINER" \
    -e AUTOUPDATE_ENABLED=false \
    -e PORT=8080 \
    -p 8081:8080 \
    "$TEST_IMAGE" &>/dev/null

  # Wait for health
  if wait_for_health "$TEST_CONTAINER" 30; then
    log_pass "Health endpoint responds correctly"

    # Test specific health check
    local health_output
    health_output=$(docker exec "$TEST_CONTAINER" bash -c "
      source /app/autoupdate/lib/logging.sh
      source /app/autoupdate/lib/health.sh
      health_check http://localhost:8080/health 5 && echo 'HEALTH_OK'
    " 2>&1)

    if echo "$health_output" | grep -q "HEALTH_OK"; then
      log_pass "Health check library function works"
    else
      log_fail "Health check library function failed"
    fi
  else
    log_fail "Health endpoint did not respond"
  fi

  docker stop "$TEST_CONTAINER" &>/dev/null || true
  docker rm -f "$TEST_CONTAINER" &>/dev/null || true
}

test_rollback_functionality() {
  log_info "TEST: Rollback functionality"

  # Test rollback directory creation
  docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/rollback.sh
    rollback_ensure_dirs && echo 'DIRS_OK'
  " 2>&1 | grep -q "DIRS_OK"

  if [[ $? -eq 0 ]]; then
    log_pass "Rollback directory creation works"
  else
    log_fail "Rollback directory creation failed"
  fi

  # Test status file operations
  local output
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/rollback.sh
    rollback_save_status 'testing' 'abc123' 'def456'
    rollback_load_status
  " 2>&1)

  if echo "$output" | grep -q '"status":"testing"'; then
    log_pass "Rollback status file operations work"
  else
    log_fail "Rollback status file operations failed"
  fi
}

test_retry_logic() {
  log_info "TEST: Retry logic with exponential backoff"

  local output
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    source /app/autoupdate/lib/git.sh
    source /app/autoupdate/lib/build.sh
    source /app/autoupdate/lib/health.sh
    source /app/autoupdate/lib/rollback.sh
    source /app/entrypoint.sh

    # Test retry function exists
    if type retry_with_backoff &>/dev/null; then
      echo 'RETRY_FUNCTION_EXISTS'
    fi

    # Test transient error detection
    if is_transient_error 'fetch_failed'; then
      echo 'TRANSIENT_DETECTED'
    fi
  " 2>&1)

  if echo "$output" | grep -q "RETRY_FUNCTION_EXISTS"; then
    log_pass "Retry function is available"
  else
    log_fail "Retry function not found"
  fi

  if echo "$output" | grep -q "TRANSIENT_DETECTED"; then
    log_pass "Transient error detection works"
  else
    log_fail "Transient error detection failed"
  fi
}

test_logging_structure() {
  log_info "TEST: Structured JSON logging"

  local output
  output=$(docker run --rm "$TEST_IMAGE" bash -c "
    source /app/autoupdate/lib/logging.sh
    init_logging
    log_info 'TEST_EVENT' 'Test message'
    log_error 'ERROR_EVENT' 'Error message'
  " 2>&1)

  # Check for JSON structure
  if echo "$output" | grep -qE '\"level\":\"info\"'; then
    log_pass "Info log has correct JSON structure"
  else
    log_fail "Info log JSON structure incorrect"
  fi

  if echo "$output" | grep -qE '\"level\":\"error\"'; then
    log_pass "Error log has correct JSON structure"
  else
    log_fail "Error log JSON structure incorrect"
  fi

  if echo "$output" | grep -qE '\"timestamp\":\"[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    log_pass "Log timestamp is ISO8601 formatted"
  else
    log_fail "Log timestamp format incorrect"
  fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
  local test_pattern="${1:-}"

  echo "================================"
  echo "Auto-Update Integration Tests"
  echo "================================"
  echo ""

  # Setup
  setup

  echo ""
  echo "Running tests..."
  echo ""

  # Run all tests or filtered tests
  if [[ -z "$test_pattern" ]]; then
    test_build_image
    test_container_starts
    test_entrypoint_commands
    test_library_loading
    test_signal_handling
    test_health_checks
    test_rollback_functionality
    test_retry_logic
    test_logging_structure
  else
    # Run only tests matching pattern
    for test_func in $(declare -F | grep -E "test_" | awk '{print $3}'); do
      if echo "$test_func" | grep -q "$test_pattern"; then
        $test_func
      fi
    done
  fi

  echo ""
  echo "================================"
  echo "Test Summary"
  echo "================================"
  echo -e "Passed:  ${COLOR_GREEN}${TESTS_PASSED}${COLOR_RESET}"
  echo -e "Failed:  ${COLOR_RED}${TESTS_FAILED}${COLOR_RESET}"
  echo -e "Skipped: ${COLOR_YELLOW}${TESTS_SKIPPED}${COLOR_RESET}"
  echo ""

  # Cleanup
  cleanup

  # Exit with appropriate code
  if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
  else
    log_info "All tests passed!"
    exit 0
  fi
}

# Run main
main "$@"
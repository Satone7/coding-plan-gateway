#!/usr/bin/env bash
# autoupdate-check.sh - Manual auto-update trigger script
# Version: 1.0.0
# Usage: autoupdate-check.sh [options] <container-name>
#
# This script triggers a manual update check on a running container
# by sending SIGUSR1 signal to the entrypoint process.

set -euo pipefail

readonly VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Default configuration
CONTAINER_NAME=""
DOCKER_CMD="docker"
TIMEOUT=30
WAIT_FOR_COMPLETION=false
VERBOSE=false

# Print usage information
usage() {
  cat << EOF
Usage: ${SCRIPT_NAME} [options] <container-name>

Trigger a manual auto-update check on a running Docker container.

Arguments:
  container-name    Name or ID of the container to trigger update on

Options:
  -h, --help        Show this help message and exit
  -v, --verbose     Enable verbose output
  -V, --version     Show version information
  -t, --timeout     Timeout in seconds for update completion (default: 30)
  -w, --wait        Wait for update to complete (requires container with curl)
  -p, --podman      Use podman instead of docker

Signals:
  SIGUSR1           Triggers update check in the container

Examples:
  # Trigger update on container
  ${SCRIPT_NAME} my-gateway

  # Wait for update to complete with verbose output
  ${SCRIPT_NAME} -v -w -t 60 my-gateway

  # Use with podman
  ${SCRIPT_NAME} -p my-gateway

  # Trigger update in Kubernetes pod (using kubectl)
  kubectl exec my-pod -- /bin/kill -SIGUSR1 1

EOF
}

# Print version information
version() {
  echo "${SCRIPT_NAME} version ${VERSION}"
  echo "Auto-update trigger for Coding Plan Gateway"
}

# Log message with timestamp
log() {
  local level="${1:-}"
  local message="${2:-}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if [[ "$VERBOSE" == "true" ]] || [[ "$level" != "DEBUG" ]]; then
    echo "[${timestamp}] ${level}: ${message}"
  fi
}

# Check if Docker/Podman is available
check_docker() {
  if ! command -v "$DOCKER_CMD" &> /dev/null; then
    log "ERROR" "${DOCKER_CMD} is not installed or not in PATH"
    exit 1
  fi
}

# Check if container is running and has auto-update
check_container() {
  local container="${1:-}"

  log "DEBUG" "Checking container status: ${container}"

  # Check if container exists
  if ! $DOCKER_CMD ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
    log "ERROR" "Container not found: ${container}"
    exit 1
  fi

  # Check if container is running
  if ! $DOCKER_CMD ps --format '{{.Names}}' | grep -q "^${container}$"; then
    log "ERROR" "Container is not running: ${container}"
    exit 1
  fi

  # Check if container has auto-update enabled (by checking labels)
  local labels
  labels=$($DOCKER_CMD inspect --format '{{json .Config.Labels}}' "$container" 2>/dev/null || echo '{}')

  if ! echo "$labels" | grep -q "auto-update.enabled"; then
    log "WARN" "Container may not have auto-update enabled"
  fi

  log "INFO" "Container ${container} is running and valid"
}

# Get container PID for signal sending
get_container_pid() {
  local container="${1:-}"

  # Get the main PID (PID 1 in container which is the entrypoint)
  local pid
  pid=$($DOCKER_CMD inspect --format '{{.State.Pid}}' "$container" 2>/dev/null)

  if [[ -z "$pid" ]] || [[ "$pid" == "0" ]]; then
    log "ERROR" "Could not get PID for container: ${container}"
    exit 1
  fi

  echo "$pid"
}

# Send SIGUSR1 signal to trigger update
send_signal() {
  local container="${1:-}"

  log "INFO" "Sending SIGUSR1 to container: ${container}"

  # Method 1: Use docker kill with signal
  if $DOCKER_CMD kill --signal=SIGUSR1 "$container" &> /dev/null; then
    log "INFO" "Signal sent successfully via ${DOCKER_CMD} kill"
    return 0
  fi

  # Method 2: Use kill on host PID namespace
  local pid
  pid=$(get_container_pid "$container")

  if kill -USR1 "$pid" 2>/dev/null; then
    log "INFO" "Signal sent successfully via host kill"
    return 0
  fi

  log "ERROR" "Failed to send signal to container"
  return 1
}

# Wait for update to complete by polling health endpoint
wait_for_update() {
  local container="${1:-}"
  local timeout="${2:-30}"

  log "INFO" "Waiting up to ${timeout}s for update to complete..."

  local start_time
  start_time=$(date +%s)
  local end_time=$((start_time + timeout))

  while [[ $(date +%s) -lt $end_time ]]; do
    local elapsed
    elapsed=$(($(date +%s) - start_time))

    # Check if we can get logs
    if [[ "$VERBOSE" == "true" ]]; then
      local recent_logs
      recent_logs=$($DOCKER_CMD logs --tail 3 "$container" 2>&1 | grep -E "(UPDATE|BUILD|SERVICE)" || true)
      if [[ -n "$recent_logs" ]]; then
        echo "  [${elapsed}s] ${recent_logs}"
      fi
    fi

    # Check health endpoint
    local health_output
    health_output=$($DOCKER_CMD exec "$container" wget -q -O - http://localhost:8080/health 2>/dev/null || echo "")

    if [[ "$health_output" == "OK" ]] || [[ "$health_output" == *"healthy"* ]]; then
      log "INFO" "Service is healthy after ${elapsed}s"
      return 0
    fi

    sleep 2
  done

  log "WARN" "Timeout waiting for update to complete"
  return 1
}

# Get update status from container logs
get_update_status() {
  local container="${1:-}"

  log "INFO" "Checking update status in container logs..."

  # Get recent update-related logs
  $DOCKER_CMD logs --tail 20 "$container" 2>&1 | grep -E "(UPDATE_|SERVICE_)" | tail -10 || true
}

# Main function
main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      -V|--version)
        version
        exit 0
        ;;
      -v|--verbose)
        VERBOSE=true
        shift
        ;;
      -t|--timeout)
        if [[ -n "${2:-}" ]] && [[ ! "$2" =~ ^- ]]; then
          TIMEOUT="$2"
          shift 2
        else
          log "ERROR" "Option -t/--timeout requires a value"
          exit 1
        fi
        ;;
      -w|--wait)
        WAIT_FOR_COMPLETION=true
        shift
        ;;
      -p|--podman)
        DOCKER_CMD="podman"
        shift
        ;;
      -*)
        log "ERROR" "Unknown option: $1"
        usage
        exit 1
        ;;
      *)
        if [[ -z "$CONTAINER_NAME" ]]; then
          CONTAINER_NAME="$1"
          shift
        else
          log "ERROR" "Unexpected argument: $1"
          usage
          exit 1
        fi
        ;;
    esac
  done

  # Validate container name
  if [[ -z "$CONTAINER_NAME" ]]; then
    log "ERROR" "Container name is required"
    usage
    exit 1
  fi

  log "INFO" "Auto-update trigger script v${VERSION}"

  # Check prerequisites
  check_docker
  check_container "$CONTAINER_NAME"

  # Send signal to trigger update
  if ! send_signal "$CONTAINER_NAME"; then
    exit 1
  fi

  # Wait for completion if requested
  if [[ "$WAIT_FOR_COMPLETION" == "true" ]]; then
    if ! wait_for_update "$CONTAINER_NAME" "$TIMEOUT"; then
      get_update_status "$CONTAINER_NAME"
      exit 1
    fi
  else
    log "INFO" "Update triggered. Check logs with: ${DOCKER_CMD} logs -f ${CONTAINER_NAME}"
  fi

  log "INFO" "Done"
}

# Run main function
main "$@"
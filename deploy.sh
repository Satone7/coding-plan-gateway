#!/usr/bin/env bash
# deploy.sh — Deploy pre-built CPG image with auto-rollback
# Usage: ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yaml"
IMAGE_NAME="coding-plan-gateway"
CONFIG_PATH="$SCRIPT_DIR/config.yaml"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
HEALTH_TIMEOUT=90
HEALTH_INTERVAL=3

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

read_port() {
  local port=8080
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    local p
    p=$(grep -E '^PORT=' "$SCRIPT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2)
    [[ -n "$p" ]] && port="$p"
  fi
  echo "$port"
}

wait_for_health() {
  local timeout=$1 port elapsed=0
  port=$(read_port)
  while (( elapsed < timeout )); do
    if curl -sf "http://localhost:${port}/health" >/dev/null 2>&1; then return 0; fi
    sleep "$HEALTH_INTERVAL"; (( elapsed += HEALTH_INTERVAL )) || true
  done
  return 1
}

echo "=== CPG Deploy (pre-built image) ==="
echo ""

# ---- Step 1: Backup current image ----
OLD_IMAGE_ID=$(docker image inspect "${IMAGE_NAME}:latest" --format '{{.ID}}' 2>/dev/null || echo "")
if [[ -n "$OLD_IMAGE_ID" ]]; then
  BACKUP_TAG="backup-${TIMESTAMP}"
  docker image tag "${IMAGE_NAME}:latest" "${IMAGE_NAME}:${BACKUP_TAG}"
  echo "[1/5] Old image backed up as ${IMAGE_NAME}:${BACKUP_TAG}"
else
  echo "[1/5] No existing image to backup"
  BACKUP_TAG=""
fi

# ---- Step 2: Update codebase ----
echo "[2/5] Updating codebase..."
OLD_HEAD=$(git -C "$SCRIPT_DIR" rev-parse HEAD)
# Guard against uncommitted changes (matching cpg update behavior)
if ! git -C "$SCRIPT_DIR" diff --quiet 2>/dev/null || \
   ! git -C "$SCRIPT_DIR" diff --cached --quiet 2>/dev/null; then
  echo "Error: uncommitted changes detected. Commit or stash before deploying." >&2
  exit 1
fi
# Fetch may fail on hosts with unreliable GitHub access (e.g. the router's
# TUN intermittently breaks git's TLS handshake). In that case the code may
# already have been synced out-of-band (git bundle over SSH) — proceed when
# origin/master is ahead of HEAD, abort only if there is genuinely nothing
# new to deploy.
FETCH_OK=0
if git -C "$SCRIPT_DIR" fetch origin master 2>&1; then
  FETCH_OK=1
else
  echo "Warning: git fetch failed; checking whether origin/master is already up to date" >&2
fi
# Decide update state against the freshest ref we can see. FETCH_HEAD is only
# trustworthy from a fetch that SUCCEEDED just now — a stale FETCH_HEAD file
# from an older fetch can lag behind both HEAD and origin/master (e.g. this
# machine pushed since) and would wrongly abort or downgrade the deploy.
TARGET_REF=""
if [ "$FETCH_OK" = "1" ] && \
   git -C "$SCRIPT_DIR" rev-parse --verify --quiet FETCH_HEAD >/dev/null; then
  TARGET_REF="FETCH_HEAD"
elif git -C "$SCRIPT_DIR" rev-parse --verify --quiet origin/master >/dev/null; then
  TARGET_REF="origin/master"
fi
if [ -n "$TARGET_REF" ] && \
   git -C "$SCRIPT_DIR" merge-base --is-ancestor HEAD "$TARGET_REF" 2>/dev/null && \
   [ "$(git -C "$SCRIPT_DIR" rev-parse HEAD)" != "$(git -C "$SCRIPT_DIR" rev-parse "$TARGET_REF")" ]; then
  if ! git -C "$SCRIPT_DIR" reset --hard "$TARGET_REF" 2>&1; then
    echo "Error: git reset failed" >&2
    exit 1
  fi
elif [ -n "$TARGET_REF" ] && \
     [ "$(git -C "$SCRIPT_DIR" rev-parse HEAD)" = "$(git -C "$SCRIPT_DIR" rev-parse "$TARGET_REF")" ]; then
  echo "      $TARGET_REF == HEAD, nothing to update"
else
  echo "Error: fetch failed and HEAD is not an ancestor of the remote ref — cannot determine update state" >&2
  exit 1
fi
NEW_HEAD=$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)
echo "      Updated to: $NEW_HEAD"

# ---- Step 3: Backup config ----
CONFIG_BACKUP="${CONFIG_PATH}.deploy-${TIMESTAMP}.bak"
if [[ -f "$CONFIG_PATH" ]]; then
  cp "$CONFIG_PATH" "$CONFIG_BACKUP"
  echo "[3/5] Config backed up to $(basename "$CONFIG_BACKUP")"
else
  echo "[3/5] Warning: config.yaml not found, skipping"
  CONFIG_BACKUP=""
fi

# ---- Step 4: Start with new image ----
echo "[4/5] Starting gateway with new image..."
compose down gateway 2>&1 || true
compose up -d gateway 2>&1 || true

# ---- Step 5: Health check ----
echo ""
echo "Waiting for gateway to become healthy (timeout: ${HEALTH_TIMEOUT}s)..."
if wait_for_health "$HEALTH_TIMEOUT" "new version"; then
  echo ""
  echo "=== Deploy successful (${NEW_HEAD}) ==="
  # Clean up old backup image
  if [[ -n "$BACKUP_TAG" ]]; then
    docker image rmi "${IMAGE_NAME}:${BACKUP_TAG}" 2>/dev/null || true
  fi
  [[ -n "$CONFIG_BACKUP" && -f "$CONFIG_BACKUP" ]] && rm -f "$CONFIG_BACKUP"
  exit 0
fi

# ---- Rollback ----
echo "" >&2
echo "=== Health check failed — rolling back ===" >&2

# Dump failure logs
FAIL_LOG="$SCRIPT_DIR/deploy-failure-${TIMESTAMP}.log"
compose logs --no-color gateway > "$FAIL_LOG" 2>&1 || true
echo "Failure logs: $(basename "$FAIL_LOG")" >&2

# Stop
compose down gateway 2>&1 || true

# Restore config
if [[ -n "$CONFIG_BACKUP" && -f "$CONFIG_BACKUP" ]]; then
  cp "$CONFIG_BACKUP" "$CONFIG_PATH"
  echo "Config restored" >&2
fi

# Note: the codebase is intentionally NOT reverted here. Rolling HEAD back
# to OLD_HEAD while leaving the freshly-built image tagged :latest used to
# mask failed deploys — the "rollback" rebuilt from the cached layers of the
# same (new) commit and appeared to succeed while running old or new code
# unpredictably. The image tag restore below is the actual rollback.

# Restore old image
if [[ -n "$BACKUP_TAG" ]] && docker image inspect "${IMAGE_NAME}:${BACKUP_TAG}" >/dev/null 2>&1; then
  docker image tag "${IMAGE_NAME}:${BACKUP_TAG}" "${IMAGE_NAME}:latest" 2>/dev/null || true
  echo "Image rolled back to ${BACKUP_TAG}" >&2
  compose up -d gateway 2>&1 || true

  echo "Waiting for rolled-back gateway (30s)..." >&2
  if wait_for_health 30 "rollback"; then
    echo "=== Rollback successful ===" >&2
  else
    echo "Warning: rolled-back gateway also unhealthy, check logs" >&2
  fi
else
  echo "Error: no backup image, cannot rollback" >&2
fi
exit 1

#!/usr/bin/env bash
# rollback.sh - Backup and rollback library for auto-update
# Version: 1.0.0
# Usage: source this file and use rollback_* functions

set -euo pipefail

# Source logging library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./logging.sh
source "${SCRIPT_DIR}/logging.sh"

# Configuration
declare -g AUTOUPDATE_BACKUP_ENABLED="${AUTOUPDATE_BACKUP_ENABLED:-true}"
declare -g AUTOUPDATE_BACKUP_DIR="${AUTOUPDATE_BACKUP_DIR:-/app/dist.backup}"
declare -g AUTOUPDATE_BUILD_DIR="${AUTOUPDATE_BUILD_DIR:-/app/dist}"
declare -g AUTOUPDATE_NEW_BUILD_DIR="${AUTOUPDATE_NEW_BUILD_DIR:-/app/dist.new}"
declare -g AUTOUPDATE_DATA_DIR="${AUTOUPDATE_DATA_DIR:-/data}"

# Status codes
declare -r ROLLBACK_STATUS_OK=0
declare -r ROLLBACK_STATUS_NO_BACKUP=1
declare -r ROLLBACK_STATUS_RESTORE_FAILED=2
declare -r ROLLBACK_STATUS_BACKUP_FAILED=3

# Ensure data directories exist
rollback_ensure_dirs() {
  local dirs=("$AUTOUPDATE_DATA_DIR" "$(dirname "$AUTOUPDATE_BACKUP_DIR")")

  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      mkdir -p "$dir"
      log_debug "ROLLBACK_DIRS" "Created directory" "{\"path\":\"$dir\"}"
    fi
  done
}

# Create backup of current build
rollback_backup_current() {
  if [[ "$AUTOUPDATE_BACKUP_ENABLED" != "true" ]]; then
    log_warn "ROLLBACK_BACKUP" "Backup disabled, skipping"
    return $ROLLBACK_STATUS_OK
  fi

  if [[ ! -d "$AUTOUPDATE_BUILD_DIR" ]]; then
    log_warn "ROLLBACK_BACKUP" "No current build to backup" "{\"path\":\"$AUTOUPDATE_BUILD_DIR\"}"
    return $ROLLBACK_STATUS_OK
  fi

  log_info "UPDATE_BACKUP_START" "Creating backup of current build"

  # Remove old backup if exists
  if [[ -d "$AUTOUPDATE_BACKUP_DIR" ]]; then
    log_debug "ROLLBACK_BACKUP" "Removing old backup"
    rm -rf "$AUTOUPDATE_BACKUP_DIR"
  fi

  # Create new backup
  if ! cp -r "$AUTOUPDATE_BUILD_DIR" "$AUTOUPDATE_BACKUP_DIR"; then
    log_error "UPDATE_ERROR" "Failed to create backup" "{\"source\":\"$AUTOUPDATE_BUILD_DIR\",\"dest\":\"$AUTOUPDATE_BACKUP_DIR\"}"
    return $ROLLBACK_STATUS_BACKUP_FAILED
  fi

  # Verify backup
  if [[ ! -d "$AUTOUPDATE_BACKUP_DIR" ]]; then
    log_error "UPDATE_ERROR" "Backup directory not created"
    return $ROLLBACK_STATUS_BACKUP_FAILED
  fi

  local backup_size
  backup_size=$(du -sb "$AUTOUPDATE_BACKUP_DIR" | cut -f1)

  local details
  details=$(build_details "backupPath" "$AUTOUPDATE_BACKUP_DIR" "sizeBytes" "$backup_size")
  log_info "UPDATE_BACKUP_COMPLETE" "Backup created successfully" "$details"

  return $ROLLBACK_STATUS_OK
}

# Restore from backup
rollback_restore_backup() {
  log_info "UPDATE_ROLLBACK" "Restoring from backup"

  if [[ ! -d "$AUTOUPDATE_BACKUP_DIR" ]]; then
    log_error "UPDATE_ROLLBACK" "No backup available to restore" "{\"path\":\"$AUTOUPDATE_BACKUP_DIR\"}"
    return $ROLLBACK_STATUS_NO_BACKUP
  fi

  # Remove current build
  if [[ -d "$AUTOUPDATE_BUILD_DIR" ]]; then
    log_debug "UPDATE_ROLLBACK" "Removing current build"
    rm -rf "$AUTOUPDATE_BUILD_DIR"
  fi

  # Restore backup
  if ! mv "$AUTOUPDATE_BACKUP_DIR" "$AUTOUPDATE_BUILD_DIR"; then
    log_error "UPDATE_ROLLBACK" "Failed to restore backup"
    return $ROLLBACK_STATUS_RESTORE_FAILED
  fi

  log_info "UPDATE_ROLLBACK" "Backup restored successfully" "{\"path\":\"$AUTOUPDATE_BUILD_DIR\"}"
  return $ROLLBACK_STATUS_OK
}

# Check if backup exists
rollback_backup_exists() {
  [[ "$AUTOUPDATE_BACKUP_ENABLED" == "true" ]] && [[ -d "$AUTOUPDATE_BACKUP_DIR" ]]
}

# Prepare new build directory
rollback_prepare_new_build() {
  log_debug "ROLLBACK_PREPARE" "Preparing new build directory"

  # Remove any existing new build directory
  if [[ -d "$AUTOUPDATE_NEW_BUILD_DIR" ]]; then
    rm -rf "$AUTOUPDATE_NEW_BUILD_DIR"
  fi

  # Create new build directory
  mkdir -p "$AUTOUPDATE_NEW_BUILD_DIR"

  log_debug "ROLLBACK_PREPARE" "New build directory ready" "{\"path\":\"$AUTOUPDATE_NEW_BUILD_DIR\"}"
  return $ROLLBACK_STATUS_OK
}

# Perform atomic swap: new build becomes current
rollback_swap_builds() {
  log_info "UPDATE_SWAP" "Performing atomic build swap"

  # Validate new build exists
  if [[ ! -d "$AUTOUPDATE_NEW_BUILD_DIR" ]]; then
    log_error "UPDATE_SWAP" "New build directory not found"
    return $ROLLBACK_STATUS_RESTORE_FAILED
  fi

  # Create backup of current build first
  if ! rollback_backup_current; then
    log_warn "UPDATE_SWAP" "Failed to backup current build"
  fi

  # Remove current build
  if [[ -d "$AUTOUPDATE_BUILD_DIR" ]]; then
    rm -rf "$AUTOUPDATE_BUILD_DIR"
  fi

  # Move new build to current
  if ! mv "$AUTOUPDATE_NEW_BUILD_DIR" "$AUTOUPDATE_BUILD_DIR"; then
    log_error "UPDATE_SWAP" "Failed to swap builds"

    # Try to restore from backup
    if rollback_backup_exists; then
      log_info "UPDATE_SWAP" "Restoring from backup after failed swap"
      rollback_restore_backup
    fi

    return $ROLLBACK_STATUS_RESTORE_FAILED
  fi

  log_info "UPDATE_SWAP" "Build swap completed" "{\"newBuild\":\"$AUTOUPDATE_BUILD_DIR\"}"
  return $ROLLBACK_STATUS_OK
}

# Cleanup old artifacts
rollback_cleanup() {
  log_debug "ROLLBACK_CLEANUP" "Cleaning up old artifacts"

  local cleaned=0

  # Remove new build directory if exists (shouldn't after successful swap)
  if [[ -d "$AUTOUPDATE_NEW_BUILD_DIR" ]]; then
    rm -rf "$AUTOUPDATE_NEW_BUILD_DIR"
    cleaned=$((cleaned + 1))
  fi

  # Optionally remove old backup (keep for rollback)
  # Commented out to preserve backup for potential rollback
  # if [[ -d "$AUTOUPDATE_BACKUP_DIR" ]]; then
  #   rm -rf "$AUTOUPDATE_BACKUP_DIR"
  #   cleaned=$((cleaned + 1))
  # fi

  if [[ $cleaned -gt 0 ]]; then
    log_debug "ROLLBACK_CLEANUP" "Cleaned up $cleaned artifact(s)"
  fi

  return $ROLLBACK_STATUS_OK
}

# Save update status to file
rollback_save_status() {
  local status="${1:-idle}"
  local current_commit="${2:-}"
  local remote_commit="${3:-}"
  local error="${4:-}"

  rollback_ensure_dirs

  local status_file="$AUTOUPDATE_DATA_DIR/update-status.json"
  local timestamp
  timestamp=$(_timestamp)

  # Build status JSON
  cat > "$status_file" << EOF
{
  "status": "$status",
  "timestamp": "$timestamp",
  "currentCommit": "${current_commit}",
  "remoteCommit": "${remote_commit}",
  "error": "${error}"
}
EOF

  log_debug "UPDATE_STATUS" "Status saved" "{\"status\":\"$status\",\"file\":\"$status_file\"}"
}

# Load update status from file
rollback_load_status() {
  local status_file="$AUTOUPDATE_DATA_DIR/update-status.json"

  if [[ -f "$status_file" ]]; then
    cat "$status_file"
  else
    echo '{"status":"idle","timestamp":"","currentCommit":"","remoteCommit":"","error":""}'
  fi
}

# Mark rollback as needed (for crash recovery)
rollback_mark_rollback_needed() {
  local marker_file="$AUTOUPDATE_DATA_DIR/rollback-needed"
  touch "$marker_file"
  log_warn "UPDATE_ROLLBACK" "Rollback marked as needed"
}

# Check if rollback is needed
rollback_is_needed() {
  local marker_file="$AUTOUPDATE_DATA_DIR/rollback-needed"
  [[ -f "$marker_file" ]]
}

# Clear rollback marker
rollback_clear_marker() {
  local marker_file="$AUTOUPDATE_DATA_DIR/rollback-needed"
  if [[ -f "$marker_file" ]]; then
    rm -f "$marker_file"
    log_debug "UPDATE_ROLLBACK" "Rollback marker cleared"
  fi
}

# Save build metadata
rollback_save_build_metadata() {
  local commit_hash="${1:-}"
  local build_path="${2:-$AUTOUPDATE_BUILD_DIR}"

  rollback_ensure_dirs

  local metadata_file="$AUTOUPDATE_DATA_DIR/build-metadata.json"
  local timestamp
  timestamp=$(_timestamp)

  local size
  size=$(du -sb "$build_path" 2>/dev/null | cut -f1 || echo "0")

  # Build metadata JSON
  cat > "$metadata_file" << EOF
{
  "commitHash": "$commit_hash",
  "buildTime": "$timestamp",
  "path": "$build_path",
  "size": $size
}
EOF

  log_debug "UPDATE_METADATA" "Build metadata saved" "{\"commit\":\"${commit_hash:0:8}...\"}"
}

# Export functions
export -f rollback_ensure_dirs rollback_backup_current rollback_restore_backup
export -f rollback_backup_exists rollback_prepare_new_build rollback_swap_builds
export -f rollback_cleanup rollback_save_status rollback_load_status
export -f rollback_mark_rollback_needed rollback_is_needed rollback_clear_marker
export -f rollback_save_build_metadata
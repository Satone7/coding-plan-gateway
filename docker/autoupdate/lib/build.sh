#!/usr/bin/env bash
# build.sh - Build automation library for auto-update
# Version: 1.0.0
# Usage: source this file and use build_* functions

set -euo pipefail

# Source logging library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./logging.sh
source "${SCRIPT_DIR}/logging.sh"

# Configuration
declare -g AUTOUPDATE_BUILD_TIMEOUT="${AUTOUPDATE_BUILD_TIMEOUT:-300}"
declare -g AUTOUPDATE_NODE_VERSION="${AUTOUPDATE_NODE_VERSION:-20}"

# Status codes
declare -r BUILD_STATUS_OK=0
declare -r BUILD_STATUS_FAILED=1
declare -r BUILD_STATUS_TIMEOUT=2
declare -r BUILD_STATUS_INVALID_ENV=3
declare -r BUILD_STATUS_NO_PACKAGE=4

# Verify Node.js is installed and meets version requirement
build_check_node() {
  local required_version="${1:-$AUTOUPDATE_NODE_VERSION}"

  if ! command -v node &> /dev/null; then
    log_error "UPDATE_ERROR" "Node.js is not installed"
    return $BUILD_STATUS_INVALID_ENV
  fi

  if ! command -v npm &> /dev/null; then
    log_error "UPDATE_ERROR" "npm is not installed"
    return $BUILD_STATUS_INVALID_ENV
  fi

  local node_version
  node_version=$(node -v | sed 's/v//')
  local major_version
  major_version=$(echo "$node_version" | cut -d. -f1)

  if [[ "$major_version" -lt "$required_version" ]]; then
    log_error "UPDATE_ERROR" "Node.js version too old" \
      "{\"current\":\"$node_version\",\"required\":\">=$required_version\"}"
    return $BUILD_STATUS_INVALID_ENV
  fi

  log_debug "BUILD_CHECK" "Node.js version OK" "{\"version\":\"$node_version\"}"
  return $BUILD_STATUS_OK
}

# Verify package.json exists
build_check_package() {
  local work_dir="${1:-/app}"

  if [[ ! -f "$work_dir/package.json" ]]; then
    log_error "UPDATE_ERROR" "package.json not found" "{\"path\":\"$work_dir/package.json\"}"
    return $BUILD_STATUS_NO_PACKAGE
  fi

  return $BUILD_STATUS_OK
}

# Install dependencies using npm ci
build_install_deps() {
  local work_dir="${1:-/app}"
  local production_only="${2:-false}"

  log_info "UPDATE_BUILD_START" "Installing dependencies" "{\"production\":$production_only}"

  cd "$work_dir" || return $BUILD_STATUS_FAILED

  local exit_code=0

  if [[ "$production_only" == "true" ]]; then
    # Production install only
    set +e
    timeout "$AUTOUPDATE_BUILD_TIMEOUT" npm ci --only=production 2>&1
    exit_code=$?
    set -e
  else
    # Full install (dev deps needed for build)
    set +e
    timeout "$AUTOUPDATE_BUILD_TIMEOUT" npm ci 2>&1
    exit_code=$?
    set -e
  fi

  if [[ $exit_code -eq 124 ]]; then
    log_error "UPDATE_ERROR" "npm install timed out" "{\"timeout\":$AUTOUPDATE_BUILD_TIMEOUT}"
    return $BUILD_STATUS_TIMEOUT
  elif [[ $exit_code -ne 0 ]]; then
    log_error "UPDATE_ERROR" "npm install failed" "{\"exitCode\":$exit_code}"
    return $BUILD_STATUS_FAILED
  fi

  log_info "UPDATE_BUILD_COMPLETE" "Dependencies installed"
  return $BUILD_STATUS_OK
}

# Run build process
build_compile() {
  local work_dir="${1:-/app}"

  log_info "UPDATE_BUILD_START" "Compiling application"

  cd "$work_dir" || return $BUILD_STATUS_FAILED

  # Check if build script exists
  if ! npm run | grep -q "^  build$"; then
    log_warn "UPDATE_BUILD" "No build script found in package.json"
    # Not all projects need a build step
    return $BUILD_STATUS_OK
  fi

  # Run build with timeout
  local exit_code=0
  set +e
  timeout "$AUTOUPDATE_BUILD_TIMEOUT" npm run build 2>&1
  exit_code=$?
  set -e

  if [[ $exit_code -eq 124 ]]; then
    log_error "UPDATE_ERROR" "Build timed out" "{\"timeout\":$AUTOUPDATE_BUILD_TIMEOUT}"
    return $BUILD_STATUS_TIMEOUT
  elif [[ $exit_code -ne 0 ]]; then
    log_error "UPDATE_ERROR" "Build failed" "{\"exitCode\":$exit_code}"
    return $BUILD_STATUS_FAILED
  fi

  log_info "UPDATE_BUILD_COMPLETE" "Application compiled successfully"
  return $BUILD_STATUS_OK
}

# Validate build output exists
build_validate_output() {
  local work_dir="${1:-/app}"
  local output_dir="${2:-dist}"

  log_debug "BUILD_VALIDATE" "Validating build output"

  local full_output_path="$work_dir/$output_dir"

  if [[ ! -d "$full_output_path" ]]; then
    log_error "UPDATE_ERROR" "Build output directory not found" "{\"path\":\"$full_output_path\"}"
    return $BUILD_STATUS_FAILED
  fi

  # Check if directory has content
  local file_count
  file_count=$(find "$full_output_path" -type f | wc -l)

  if [[ "$file_count" -eq 0 ]]; then
    log_error "UPDATE_ERROR" "Build output directory is empty" "{\"path\":\"$full_output_path\"}"
    return $BUILD_STATUS_FAILED
  fi

  # Check for index.js or main entry point
  if [[ ! -f "$full_output_path/index.js" ]] && [[ ! -f "$full_output_path/main.js" ]]; then
    # Look for any .js files
    local js_files
    js_files=$(find "$full_output_path" -name "*.js" -type f | wc -l)

    if [[ "$js_files" -eq 0 ]]; then
      log_error "UPDATE_ERROR" "No JavaScript files found in build output"
      return $BUILD_STATUS_FAILED
    fi
  fi

  local details
  details=$(build_details "outputDir" "$output_dir" "fileCount" "$file_count")
  log_info "BUILD_VALIDATE" "Build output validated" "$details"

  return $BUILD_STATUS_OK
}

# Calculate build checksum for verification
build_calculate_checksum() {
  local output_dir="${1:-/app/dist}"

  if [[ ! -d "$output_dir" ]]; then
    echo ""
    return 1
  fi

  # Calculate SHA256 checksum of all files in build directory
  find "$output_dir" -type f -exec sha256sum {} \; | sort | sha256sum | cut -d' ' -f1
}

# Get build size in bytes
build_get_size() {
  local output_dir="${1:-/app/dist}"

  if [[ ! -d "$output_dir" ]]; then
    echo "0"
    return 1
  fi

  du -sb "$output_dir" | cut -f1
}

# Full build process
build_run() {
  local work_dir="${1:-/app}"
  local output_dir="${2:-dist}"

  log_info "UPDATE_BUILD_START" "Starting full build process"

  # Pre-flight checks
  if ! build_check_node; then
    return $BUILD_STATUS_INVALID_ENV
  fi

  if ! build_check_package "$work_dir"; then
    return $BUILD_STATUS_NO_PACKAGE
  fi

  # Install dependencies
  if ! build_install_deps "$work_dir" false; then
    return $BUILD_STATUS_FAILED
  fi

  # Compile
  if ! build_compile "$work_dir"; then
    return $BUILD_STATUS_FAILED
  fi

  # Validate output
  if ! build_validate_output "$work_dir" "$output_dir"; then
    return $BUILD_STATUS_FAILED
  fi

  # Calculate checksum and size for metadata
  local checksum
  checksum=$(build_calculate_checksum "$work_dir/$output_dir")
  local size
  size=$(build_get_size "$work_dir/$output_dir")

  local details
  details=$(build_details "checksum" "${checksum:0:16}..." "sizeBytes" "$size")
  log_info "UPDATE_BUILD_COMPLETE" "Build completed successfully" "$details"

  return $BUILD_STATUS_OK
}

# Clean production dependencies after build (for smaller runtime footprint)
build_cleanup_dev_deps() {
  local work_dir="${1:-/app}"

  log_info "UPDATE_BUILD_CLEANUP" "Removing development dependencies"

  cd "$work_dir" || return 1

  # Re-run npm ci with production only
  local exit_code=0
  set +e
  timeout "$AUTOUPDATE_BUILD_TIMEOUT" npm ci --only=production 2>&1
  exit_code=$?
  set -e

  if [[ $exit_code -eq 124 ]]; then
    log_warn "UPDATE_BUILD_CLEANUP" "Cleanup timed out"
    return 1
  elif [[ $exit_code -ne 0 ]]; then
    log_warn "UPDATE_BUILD_CLEANUP" "Cleanup failed"
    return 1
  fi

  log_info "UPDATE_BUILD_COMPLETE" "Development dependencies removed"
  return 0
}

# Export functions
export -f build_check_node build_check_package build_install_deps build_compile
export -f build_validate_output build_calculate_checksum build_get_size
export -f build_run build_cleanup_dev_deps
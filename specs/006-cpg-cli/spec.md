# Feature Specification: CPG CLI Executable

**Feature Branch**: `006-cpg-cli`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "创建一个新的feature，让项目可以生产一个可执行文件，并可以通过命令cpg xxx执行相关命令，如创建api key等等，并且更新e2e和正式的Dockerfile来支持这种方式使用cpg。例如，用户启动gateway服务后，可以通过`docker exec gateway cpg key create`来创建api key，并且创建的新的api key可以马上在运行中的gateway服务中生效。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute CLI Commands via `cpg` Executable (Priority: P1)

As a gateway administrator, I want to run management commands using the `cpg` executable so that I have a unified and convenient interface for gateway operations.

**Why this priority**: The core value proposition - replacing npm scripts with a standalone executable is the foundation of this feature.

**Independent Test**: Can be fully tested by building the executable, running commands like `cpg key create --name "test"`, and verifying the command executes successfully.

**Acceptance Scenarios**:

1. **Given** the `cpg` executable is built and available, **When** I run `cpg --help`, **Then** a help message showing all available commands is displayed.
2. **Given** the `cpg` executable is available, **When** I run `cpg key create --name "Test Key"`, **Then** a new API key is created and displayed.
3. **Given** the `cpg` executable is available, **When** I run `cpg key list`, **Then** all existing API keys are listed with their metadata.
4. **Given** an invalid command is provided, **When** I run `cpg invalid-command`, **Then** an error message is shown with available commands.
5. **Given** a valid API key exists, **When** I run `cpg key test <key>`, **Then** the key validation status is displayed (valid/invalid/disabled/expired).

---

### User Story 2 - Docker Container CLI Support (Priority: P2)

As a gateway administrator, I want to execute CLI commands inside a running Docker container so that I can manage the gateway without accessing the host filesystem.

**Why this priority**: Docker support is essential for production deployments and enables seamless container management.

**Independent Test**: Can be fully tested by starting a gateway container, running `docker exec gateway cpg key create`, and verifying the key is created.

**Acceptance Scenarios**:

1. **Given** a gateway container is running, **When** I run `docker exec gateway cpg key create --name "Docker Key"`, **Then** a new API key is created inside the container.
2. **Given** a gateway container is running, **When** I run `docker exec gateway cpg key list`, **Then** all API keys in the container are listed.
3. **Given** the gateway container is running, **When** I run `docker exec gateway cpg --version`, **Then** the version information is displayed.

---

### User Story 3 - Real-time Key Availability in Running Gateway (Priority: P3)

As a gateway administrator, I want API keys created via the CLI to be immediately available for authentication in the running gateway service without requiring a restart.

**Why this priority**: This enables seamless key management during production operation without service interruption.

**Independent Test**: Can be fully tested by starting the gateway, creating a new key via `cpg key create`, and immediately using that key to make an authenticated API request.

**Acceptance Scenarios**:

1. **Given** the gateway service is running, **When** I create a new API key via `cpg key create`, **Then** the key is immediately available for authentication.
2. **Given** the gateway service is running, **When** I disable an API key via `cpg key disable`, **Then** the key is immediately rejected for authentication.
3. **Given** the gateway service is running, **When** I delete an API key via `cpg key delete`, **Then** the key is immediately removed and cannot authenticate.

---

### User Story 4 - E2E Testing Environment Support (Priority: P4)

As a developer, I want the E2E testing environment to support the `cpg` CLI so that I can manage API keys during testing scenarios.

**Why this priority**: E2E testing support ensures consistent testing experience and validates the CLI works in containerized environments.

**Independent Test**: Can be fully tested by starting the E2E environment, running CLI commands from the test container, and verifying operations succeed.

**Acceptance Scenarios**:

1. **Given** the E2E environment is running, **When** I run `docker exec gateway cpg key create --name "E2E Test Key"`, **Then** the key is created successfully.
2. **Given** the E2E environment is running with a test key, **When** I run `docker exec gateway cpg usage-report`, **Then** the usage report is displayed.

---

### Edge Cases

- What happens when the CLI is run without required environment variables (e.g., ENCRY_KEY)? Display a clear error message indicating missing configuration.
- What happens when the storage file is corrupted or inaccessible? Log error, show user-friendly message, suggest recovery steps.
- What happens when the gateway service is not running but CLI commands are executed? CLI commands operate on the same storage files, so they work independently of the running service.
- What happens when multiple CLI commands are run simultaneously? File-based operations use atomic writes, preventing concurrent write conflicts.
- What happens when the CLI is invoked with insufficient permissions to access storage files? Display permission error with suggested fix.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a standalone executable named `cpg` that can be invoked directly from the command line.
- **FR-002**: System MUST support all existing API key management commands: `key create`, `key list`, `key disable`, `key enable`, `key delete`.
- **FR-002b**: System MUST support `key test <key>` command to validate whether an API key is valid and active.
- **FR-002a**: System MUST use fixed `cpg_` prefix for all generated API keys (no custom prefix support).
- **FR-003**: System MUST support usage reporting command: `usage-report` with optional filtering parameters.
- **FR-004**: System MUST display help information when invoked with `--help` or `-h` flag.
- **FR-005**: System MUST display version information when invoked with `--version` or `-v` flag.
- **FR-006**: System MUST exit with appropriate exit codes (0 for success, non-zero for errors).
- **FR-007**: System MUST produce human-readable output with proper formatting (tables for lists, clear messages for actions) by default.
- **FR-007a**: System MUST support `--json` flag to output results in JSON format for automation and scripting.
- **FR-008**: System MUST support configuration via environment variables (CONFIG_PATH, ENCRYPTION_KEY, GATEWAY_URL, etc.).
- **FR-008a**: System MUST default GATEWAY_URL to `http://localhost:8080` for internal API communication.
- **FR-009**: System MUST include the `cpg` executable in production Docker images.
- **FR-010**: System MUST include the `cpg` executable in E2E testing Docker images.
- **FR-011**: System MUST ensure CLI operations immediately update shared storage that the gateway service reads.
- **FR-011a**: System MUST provide an internal API endpoint (e.g., `POST /internal/keys/reload`) for CLI to notify gateway of storage changes.
- **FR-011a-1**: Internal API endpoint MUST be accessible only from localhost (no external network exposure).
- **FR-011a-2**: Internal API endpoint MUST NOT require authentication (localhost binding provides sufficient security).
- **FR-011b**: Gateway service MUST reload API keys from storage immediately upon receiving notification from CLI.
- **FR-012**: System MUST support running CLI commands via `docker exec <container> cpg <command>`.

### Security Requirements

- **SR-001**: Internal API endpoints (e.g., `/internal/*`) MUST bind to localhost only, rejecting external network requests.
- **SR-002**: Internal API endpoints MUST NOT require authentication, relying on localhost binding for security isolation.

### Key Entities

- **CLI Entry Point**: The executable entry that parses command-line arguments, loads configuration, and dispatches to appropriate command handlers. Attributes: command name, subcommands, flags, arguments.
- **Command Handler**: A function that executes a specific CLI command. Attributes: command name, argument schema, execution logic, output formatter.
- **Shared Storage**: File-based storage (api-keys.json, usage-data.json) accessible by both CLI and running gateway service, enabling real-time key availability.
- **Internal Notification API**: HTTP endpoint (`/internal/keys/reload`) that CLI calls after modifying storage, triggering gateway to reload keys immediately.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: CLI commands complete in under 1 second for typical operations (key creation, listing).
- **SC-002**: API keys created via CLI are available for authentication within 100 milliseconds.
- **SC-003**: CLI executable size is under 50MB (compressed in Docker image).
- **SC-004**: All CLI commands produce deterministic, testable output suitable for automation.
- **SC-005**: CLI works identically on host machine and inside Docker containers.
- **SC-006**: Zero additional dependencies required beyond what's already in the production Docker image.

## Clarifications

### Session 2026-03-24

- Q: Does CLI need to support machine-readable output formats for automation scripts? → A: Yes, add `--json` flag for JSON output support (default remains human-readable format).
- Q: Should API key creation support custom prefixes or enforce fixed `cpg_` prefix? → A: Enforce fixed `cpg_` prefix only (simpler, avoids conflicts, easy to identify key origin).
- Q: How does gateway service detect new API keys created by CLI? → A: CLI calls internal API to notify gateway service after creation (real-time update without polling delay).
- Q: How does CLI find running gateway service to send notification? → A: Default to `localhost:8080`, configurable via `GATEWAY_URL` environment variable.
- Q: Does internal API endpoint (`/internal/keys/reload`) require authentication? → A: No authentication needed, localhost-only access provides sufficient security isolation.
- Q: Should CLI provide a command to validate if an API key is valid? → A: Yes, add `cpg key test <key>` command for key validation testing.

## Assumptions

- File-based storage is shared between CLI and gateway service via volume mounts in Docker.
- CLI notifies gateway service of storage changes via internal HTTP API for immediate key availability.
- Node.js runtime is available in Docker images for executing the CLI.
- Single-user deployment means no concurrent CLI access coordination is needed beyond atomic file writes.
- The CLI will be implemented in TypeScript and compiled to JavaScript, executed via Node.js (no native binary compilation required).
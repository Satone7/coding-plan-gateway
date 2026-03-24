# Feature Specification: E2E Docker Testing Environment

**Feature Branch**: `003-e2e-docker-testing`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "设计一个新的feature，构造一个e2e的测试环境，通过docker运行一个claude code，并且在claude code里配置使用该项目的base url和kimi-k2.5模型"

## Clarifications

### Session 2026-03-24

- Q: How should the e2e tests be executed? → A: Manual interactive - Developer runs Claude Code interactively to verify
- Q: How should API keys for upstream providers be provided to the test environment? → A: Config file mount - Mount a YAML/JSON config file with API keys
- Q: How should the Docker environment be structured? → A: Single docker-compose.yml - All services in one file
- Q: Should the test configuration file include a sample/template with example values? → A: Sample with placeholders - Provide template file with example structure
- Q: How should logs from the gateway and Claude Code container be made accessible to developers? → A: Mounted volumes - Write logs to host-mounted directories

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run Claude Code in Docker Container (Priority: P1)

As a developer, I want to run Claude Code inside a Docker container so that I can test the gateway in an isolated, reproducible environment without affecting my local development setup.

**Why this priority**: This is the foundation for all e2e testing. Without a containerized Claude Code environment, there is no way to perform reliable end-to-end tests of the gateway.

**Independent Test**: Can be fully tested by building and running the Docker container, then verifying Claude Code is installed and accessible within the container.

**Acceptance Scenarios**:

1. **Given** a Docker environment is available, **When** the developer builds the test container, **Then** a Docker image containing Claude Code CLI is created successfully.
2. **Given** the test container image exists, **When** the developer runs the container, **Then** Claude Code CLI is available and executable inside the container.
3. **Given** the container is running, **When** the developer checks the container environment, **Then** the container has the correct Node.js version and dependencies installed.

---

### User Story 2 - Configure Claude Code to Use Gateway (Priority: P1)

As a developer, I want Claude Code to connect to the local gateway service so that I can verify the gateway correctly handles requests from a real Claude Code client.

**Why this priority**: This is essential for validating the gateway works with actual Claude Code traffic patterns. Without this, we cannot perform true e2e testing.

**Independent Test**: Can be fully tested by starting the gateway, running the containerized Claude Code with configured environment variables, and verifying requests reach the gateway.

**Acceptance Scenarios**:

1. **Given** the gateway is running on localhost:8080, **When** the container starts with `ANTHROPIC_BASE_URL=http://localhost:8080`, **Then** Claude Code sends all API requests to the gateway.
2. **Given** the container is configured with `ANTHROPIC_MODEL=kimi-k2.5`, **When** Claude Code makes a request, **Then** the request specifies the kimi-k2.5 model.
3. **Given** both gateway and container are running, **When** Claude Code initiates a conversation, **Then** the gateway receives and logs the incoming request.

---

### User Story 3 - Verify Gateway Request Handling (Priority: P2)

As a developer, I want to verify that the gateway correctly routes requests and returns responses so that I can confirm the full request-response cycle works end-to-end.

**Why this priority**: This validates the complete integration between Claude Code and the gateway, ensuring the gateway behaves correctly with real client traffic.

**Independent Test**: Can be fully tested by sending a test prompt through Claude Code and verifying the gateway logs show correct routing and the response is received.

**Acceptance Scenarios**:

1. **Given** a valid coding plan is configured in the gateway, **When** Claude Code sends a chat request, **Then** the gateway routes the request to the appropriate upstream provider.
2. **Given** the upstream provider responds successfully, **When** the gateway receives the response, **Then** Claude Code receives and displays the response correctly.
3. **Given** the gateway encounters an error, **When** routing fails, **Then** Claude Code receives a meaningful error message.

---

### User Story 4 - Interactive Test Verification Guide (Priority: P3)

As a developer, I want a guide for manually testing the gateway with Claude Code so that I can systematically verify the gateway works correctly during development.

**Why this priority**: Documentation supports consistent testing practices but can be added after the core functionality works.

**Independent Test**: Can be fully tested by following the guide steps and confirming each verification point is documented.

**Acceptance Scenarios**:

1. **Given** the test environment is running, **When** the developer opens the test guide, **Then** clear steps for interactive verification are provided.
2. **Given** a test scenario is documented, **When** the developer follows the steps, **Then** expected behavior is clearly described for comparison.
3. **Given** common issues occur, **When** the developer consults the guide, **Then** troubleshooting steps are available.

---

### Edge Cases

- What happens when the gateway is not running when Claude Code tries to connect?
- How does the system handle when the configured model (kimi-k2.5) is not available in any coding plan?
- What happens when the gateway container restarts while Claude Code is mid-conversation?
- How does Claude Code handle streaming responses from the gateway?
- What happens if the gateway returns an error response (rate limit, quota exceeded)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a Dockerfile that builds a container image with Claude Code CLI installed.
- **FR-002**: The system MUST support configuration of Claude Code via environment variables including `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL`.
- **FR-003**: The system MUST provide a single docker-compose.yml file that orchestrates the gateway and Claude Code test container together.
- **FR-004**: The system MUST include a test coding plan configuration file (YAML/JSON) with kimi-k2.5 model support that can be mounted into the gateway container.
- **FR-004a**: The system MUST provide a sample configuration template with placeholder values that developers can copy and customize with their actual API keys.
- **FR-005**: The system MUST provide scripts to start, stop, and reset the e2e test environment.
- **FR-006**: The system MUST capture logs from both the gateway and Claude Code container to host-mounted volumes for easy access and debugging.
- **FR-007**: The system MUST support network communication between containers using Docker networking.
- **FR-008**: The system MUST allow mounting of configuration files (containing API keys) and reference materials into containers for interactive testing.

### Key Entities

- **Test Container**: A Docker container running Claude Code CLI with pre-configured environment variables. Contains Node.js runtime and Claude Code installation.
- **Gateway Service**: The coding-plan-gateway service running in Docker, accessible to the test container via Docker network.
- **Test Configuration**: A YAML/JSON configuration file defining the test coding plan(s) with kimi-k2.5 model support and upstream provider API keys, mounted into the gateway container.
- **E2E Test Script**: An executable script that orchestrates the test environment lifecycle (start, stop, cleanup) for interactive testing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can start the complete e2e test environment with a single command in under 60 seconds.
- **SC-002**: Claude Code successfully connects to the gateway and sends requests with correct configuration within 10 seconds of container startup.
- **SC-003**: The gateway logs show requests arriving with the correct model name (kimi-k2.5) in 100% of test cases.
- **SC-004**: The test environment can be completely cleaned up (all containers stopped and removed) in under 30 seconds.
- **SC-005**: The e2e test environment can be reproduced consistently across different development machines without manual configuration changes.

## Assumptions

- Docker is installed and running on the developer's machine.
- The developer has access to a valid API key for an upstream provider that supports the kimi-k2.5 model.
- API keys are provided via a mounted configuration file (YAML/JSON) rather than environment variables.
- The gateway's Anthropic-compatible endpoint (`/v1/messages`) is used by Claude Code for communication.
- Network connectivity exists between the test container and the gateway container via Docker bridge network.
- The test environment is for development/testing purposes only, not production deployment.
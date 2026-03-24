# Feature Specification: E2E Docker Testing Environment

**Feature Branch**: `003-e2e-docker-testing`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "设计一个新的feature，构造一个e2e的测试环境，通过docker运行一个claude code，并且在claude code里配置使用该项目的base url和kimi-k2.5模型"

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

### User Story 4 - Automated E2E Test Execution (Priority: P3)

As a developer, I want to run automated e2e tests using the Docker environment so that I can verify the gateway works correctly as part of CI/CD pipelines.

**Why this priority**: Automation improves development workflow efficiency but can be added after manual testing is validated.

**Independent Test**: Can be fully tested by running the e2e test script and verifying all test cases pass.

**Acceptance Scenarios**:

1. **Given** all services are configured, **When** the developer runs the e2e test command, **Then** the test suite starts the gateway, runs Claude Code tests, and reports results.
2. **Given** an e2e test fails, **When** the test completes, **Then** detailed logs and error information are captured for debugging.
3. **Given** tests complete, **When** the test runner finishes, **Then** all containers and services are properly cleaned up.

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
- **FR-003**: The system MUST provide a Docker Compose configuration that orchestrates the gateway and Claude Code test container.
- **FR-004**: The system MUST include a test coding plan configuration with kimi-k2.5 model support.
- **FR-005**: The system MUST provide scripts to start, stop, and reset the e2e test environment.
- **FR-006**: The system MUST capture logs from both the gateway and Claude Code container for debugging.
- **FR-007**: The system MUST support network communication between containers using Docker networking.
- **FR-008**: The system MUST allow mounting of test prompts or scripts into the Claude Code container.

### Key Entities

- **Test Container**: A Docker container running Claude Code CLI with pre-configured environment variables. Contains Node.js runtime and Claude Code installation.
- **Gateway Service**: The coding-plan-gateway service running in Docker, accessible to the test container via Docker network.
- **Test Configuration**: A configuration file defining the test coding plan(s) with kimi-k2.5 model support for the gateway.
- **E2E Test Script**: An executable script that orchestrates the test environment lifecycle (start, run tests, cleanup).

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
- The gateway's Anthropic-compatible endpoint (`/v1/messages`) is used by Claude Code for communication.
- Network connectivity exists between the test container and the gateway container via Docker bridge network.
- The test environment is for development/testing purposes only, not production deployment.
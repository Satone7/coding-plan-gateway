# Feature Specification: Fix E2E Claude Code Execution

**Feature Branch**: `004-fix-e2e-exec`
**Created**: 2026-03-24
**Status**: Draft
**Input**: User description: "创建一个新的feature，当前项目中存在问题，你可以通过启动e2e测试环境，并使用命令`docker exec -it claude-code claude -p hello`验证，该feature的目的是修复问题，使得命令`docker exec -it claude-code claude -p hello`在e2e测试环境中正确运行，得到正常的返回结果"

## Problem Analysis

After investigation, two issues were identified:

1. **Missing Authentication Environment Variable**: The Claude Code container requires `ANTHROPIC_API_KEY` environment variable to be set for authentication, even when using a custom base URL. Without this variable, Claude Code shows "Not logged in · Please run /login" error.

2. **Request Schema Validation Error**: The gateway's Anthropic API endpoint validation schema only accepts the `system` field as a string. However, newer versions of Claude Code (2.1.81+) send the `system` field as an array of content blocks according to the newer Anthropic API specification. This causes a validation error: "Expected string, received array".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claude Code Authentication in E2E Environment (Priority: P1)

As a developer, I want Claude Code to authenticate automatically in the e2e test environment so that I can run interactive tests without manual login steps.

**Why this priority**: Without proper authentication, Claude Code cannot make any API requests, making the entire e2e testing environment non-functional.

**Independent Test**: Can be fully tested by starting the e2e environment and running `docker exec claude-code claude -p hello` to verify the request reaches the gateway without authentication errors.

**Acceptance Scenarios**:

1. **Given** the e2e environment is started, **When** the Claude Code container initializes, **Then** the `ANTHROPIC_API_KEY` environment variable is set with a placeholder value.
2. **Given** the Claude Code container has `ANTHROPIC_API_KEY` set, **When** a request is made to the gateway, **Then** the gateway accepts the request without authentication errors.
3. **Given** a valid coding plan is configured, **When** Claude Code sends a request, **Then** the gateway routes it to the upstream provider using the configured API key.

---

### User Story 2 - System Prompt Array Support (Priority: P1)

As a developer, I want the gateway to accept both string and array formats for the `system` field in Anthropic API requests so that newer versions of Claude Code can work correctly.

**Why this priority**: Without this fix, Claude Code 2.1.81+ cannot communicate with the gateway, breaking all e2e testing functionality.

**Independent Test**: Can be fully tested by sending an Anthropic API request with `system` as an array and verifying the gateway processes it without validation errors.

**Acceptance Scenarios**:

1. **Given** an Anthropic API request with `system` as a string, **When** the request is sent to the gateway, **Then** the gateway processes it successfully.
2. **Given** an Anthropic API request with `system` as an array of content blocks, **When** the request is sent to the gateway, **Then** the gateway accepts and forwards it to the upstream provider.
3. **Given** an Anthropic API request with `system` as an array, **When** the upstream provider expects a string, **Then** the gateway converts the array format appropriately (if needed for provider compatibility).

---

### User Story 3 - End-to-End Verification (Priority: P2)

As a developer, I want to verify that the complete e2e testing flow works so that I can confidently use the environment for development and testing.

**Why this priority**: This validates that all fixes work together correctly, ensuring the e2e environment is fully functional.

**Independent Test**: Can be fully tested by running the complete test flow: start environment, execute Claude Code command, verify response, stop environment.

**Acceptance Scenarios**:

1. **Given** the e2e environment is started with a valid coding plan, **When** `docker exec claude-code claude -p "hello"` is executed, **Then** Claude Code receives a valid response from the AI model.
2. **Given** the e2e environment is running, **When** multiple requests are sent sequentially, **Then** all requests are processed correctly without errors.
3. **Given** a request fails at the upstream provider, **When** the error is returned, **Then** Claude Code receives a meaningful error message.

---

### Edge Cases

- What happens when the `system` array contains multiple content blocks of different types (text, image)?
- How does the gateway handle an empty `system` array versus a missing `system` field?
- What happens when `ANTHROPIC_API_KEY` is set but the gateway configuration has no valid plans?
- How does the system handle very long system prompts (either as string or array)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The e2e Docker Compose configuration MUST include `ANTHROPIC_API_KEY` environment variable for the Claude Code container with a placeholder value.
- **FR-002**: The gateway MUST accept the `system` field in Anthropic API requests as either a string or an array of content blocks.
- **FR-003**: The gateway MUST preserve the `system` field format when forwarding requests to upstream providers, unless the provider requires a specific format.
- **FR-004**: The gateway MUST validate both string and array formats for the `system` field according to the Anthropic API specification.
- **FR-005**: The e2e environment MUST allow Claude Code to make requests immediately after container startup without manual authentication steps.
- **FR-006**: The gateway MUST log warnings if the `system` array format cannot be converted for a specific upstream provider (if applicable).

### Key Entities

- **Anthropic System Prompt**: The system prompt field in Anthropic API requests, which can be either a simple string or an array of content blocks (text, images). Used to set the behavior and context for the AI assistant.
- **Claude Code Authentication**: The authentication mechanism used by Claude Code CLI, which requires an API key even when connecting to a custom base URL. The gateway does not validate this key but uses its own configured keys for upstream requests.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The command `docker exec claude-code claude -p hello` completes successfully with a valid AI response within 60 seconds.
- **SC-002**: Both string and array formats for the `system` field are accepted and processed without validation errors.
- **SC-003**: The e2e environment starts and is ready for Claude Code requests within 60 seconds of running `npm run e2e:start`.
- **SC-004**: No authentication-related errors appear when running Claude Code commands in the e2e environment.
- **SC-005**: All existing tests continue to pass after the schema changes.

## Assumptions

- The gateway does not need to validate the incoming API key from Claude Code; it uses its own configured API keys for upstream provider authentication.
- The upstream provider supports the same `system` field format that Claude Code sends, or the gateway passes it through unchanged.
- The placeholder value for `ANTHROPIC_API_KEY` can be any non-empty string since the gateway does not validate it.
- Developers have a valid API key configured in `e2e/test-config.yaml` for the upstream provider.

## Out of Scope

- Adding authentication/authorization to the gateway itself
- Supporting other Claude Code CLI features beyond basic prompt execution
- Modifying the upstream provider API behavior
- Adding support for non-Anthropic API formats in this fix
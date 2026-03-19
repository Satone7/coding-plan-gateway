# Feature Specification: Coding Plan Gateway

**Feature Branch**: `001-coding-plan-gateway`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "Coding plan load balancer gateway for managing multiple AI coding plan subscriptions"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Coding Plans (Priority: P1)

As a user with multiple AI coding plan subscriptions, I want to configure all my coding plans in one place so that I can use them seamlessly without manual switching.

**Why this priority**: Configuration is the foundation - without it, no other features can function. This is the minimum viable product.

**Independent Test**: Can be fully tested by adding, editing, and removing coding plan configurations and verifying they persist correctly.

**Acceptance Scenarios**:

1. **Given** I have no coding plans configured, **When** I add a new coding plan with name, base URL, API key, and supported models, **Then** the configuration is saved and persisted across restarts.
2. **Given** I have coding plans configured, **When** I edit a coding plan's details (base URL, models, quota), **Then** the changes are saved immediately.
3. **Given** I have coding plans configured, **When** I delete a coding plan, **Then** it is removed from the configuration and no longer available for routing.

---

### User Story 2 - Route Requests by Model (Priority: P1)

As a user, I want to send requests to a single endpoint and have the system automatically route them to an appropriate coding plan that supports the requested model, so that I don't need to manually switch between providers.

**Why this priority**: This is the core value proposition - automatic request routing based on model availability.

**Independent Test**: Can be fully tested by sending requests for different models and verifying they reach a coding plan that supports that model.

**Acceptance Scenarios**:

1. **Given** I have configured coding plans with different supported model lists, **When** I send a request for model "kimi-k2.5", **Then** the request is routed to a coding plan that includes "kimi-k2.5" in its supported models.
2. **Given** No coding plan supports the requested model, **When** I send a request for an unsupported model, **Then** I receive a clear error message indicating no available provider.
3. **Given** Multiple coding plans support the same model, **When** I send a request, **Then** the system selects the coding plan with the highest remaining quota.

---

### User Story 3 - Track and Prioritize by Quota (Priority: P2)

As a user, I want the system to track my usage quota for each coding plan and prioritize plans with more remaining quota, so that I maximize my total available coding plan allowance.

**Why this priority**: Quota management enables efficient resource utilization across multiple subscriptions.

**Independent Test**: Can be fully tested by configuring quotas, making requests, and verifying quota tracking and prioritization.

**Acceptance Scenarios**:

1. **Given** I have configured quota limits for my coding plans, **When** I make requests through the gateway, **Then** the system tracks and updates remaining quota for the used coding plan.
2. **Given** Multiple coding plans support the same model with different remaining quotas, **When** a request arrives, **Then** the coding plan with the highest remaining quota is selected.
3. **Given** A coding plan's quota is exhausted, **When** a request for a model it supports arrives, **Then** the system routes to another available coding plan or returns an appropriate error.

---

### User Story 4 - Provide Compatible API Endpoints (Priority: P1)

As a user, I want the gateway to provide both OpenAI and Anthropic compatible API endpoints, so that I can configure it in Claude Code or any other AI tool without modification.

**Why this priority**: API compatibility is essential for integration with existing tools like Claude Code.

**Independent Test**: Can be fully tested by configuring Claude Code to use the gateway endpoints and verifying requests are processed correctly.

**Acceptance Scenarios**:

1. **Given** The gateway is running, **When** I send an OpenAI-format request to `/v1/chat/completions`, **Then** the request is processed and a valid OpenAI-format response is returned.
2. **Given** The gateway is running, **When** I send an Anthropic-format request to `/v1/messages`, **Then** the request is processed and a valid Anthropic-format response is returned.
3. **Given** I configure Claude Code with the gateway's base URL, **When** I use Claude Code, **Then** all requests are routed through the gateway transparently.

---

### User Story 5 - View Usage Statistics (Priority: P3)

As a user, I want to view my usage statistics across all coding plans, so that I can understand my consumption patterns and optimize my subscriptions.

**Why this priority**: Monitoring helps users make informed decisions but is not essential for core functionality.

**Independent Test**: Can be fully tested by making requests and verifying statistics are accurately recorded and displayed.

**Acceptance Scenarios**:

1. **Given** I have made requests through the gateway, **When** I view the usage dashboard or logs, **Then** I see the number of requests, tokens used, and quota consumed per coding plan.
2. **Given** I have usage data, **When** I view statistics, **Then** I can see usage broken down by model and by coding plan.

---

### Edge Cases

- What happens when all coding plans supporting a model are exhausted of quota? System returns error with suggestion to wait or upgrade.
- What happens when a coding plan becomes unavailable (network error, API down)? System fails over to another coding plan supporting the same model if available, otherwise returns error.
- What happens when configuration file is corrupted? System logs error, starts with empty configuration, and notifies user.
- What happens when request exceeds maximum token limit? System returns appropriate error without forwarding to provider.
- What happens when API key for a coding plan expires? System logs authentication failure and excludes that coding plan from routing until key is updated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to configure multiple coding plans, each with name, base URL, API key, supported models list, and quota limit.
- **FR-002**: System MUST provide an OpenAI-compatible API endpoint at `/v1/chat/completions`.
- **FR-003**: System MUST provide an Anthropic-compatible API endpoint at `/v1/messages`.
- **FR-004**: System MUST route incoming requests to a coding plan that supports the requested model.
- **FR-005**: System MUST track usage quota for each coding plan based on configured limits.
- **FR-006**: System MUST prioritize coding plans with higher remaining quota when multiple plans support the same model.
- **FR-007**: System MUST return clear error messages when no coding plan supports the requested model.
- **FR-008**: System MUST persist configuration across restarts.
- **FR-009**: System MUST support streaming responses for both OpenAI and Anthropic formats.
- **FR-010**: System MUST handle authentication by forwarding API keys to upstream providers.
- **FR-011**: System MUST log requests for debugging and monitoring purposes.
- **FR-012**: System MUST support hot-reloading of configuration without restart.
- **FR-013**: System MUST validate configuration before applying changes.
- **FR-014**: System MUST support manual quota reset functionality.
- **FR-015**: System MUST provide health check endpoint for monitoring.

### Key Entities

- **Coding Plan**: Represents an AI provider subscription. Contains name, base URL, API key, list of supported models, quota limit, and current quota usage. Each coding plan is independently configurable and managed.

- **Model**: Represents an AI model identifier (e.g., "kimi-k2.5", "claude-sonnet-4-6"). Models are associated with coding plans through configuration. A model can be supported by multiple coding plans.

- **Quota**: Represents the usage allowance for a coding plan. Contains total allocated amount and current consumption. Used for routing decisions and usage tracking.

- **Request**: Represents an incoming API request from a client. Contains model identifier, messages/prompt, and parameters. Routed to appropriate coding plan based on model and quota availability.

- **Configuration**: Represents the user's settings including all coding plans, their properties, and system preferences. Persisted to storage and loaded on startup.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete initial configuration of a coding plan in under 2 minutes.
- **SC-002**: Gateway processes and routes requests within 50ms overhead (excluding upstream provider latency).
- **SC-003**: Users successfully route requests to appropriate coding plans on first attempt without manual intervention.
- **SC-004**: System correctly tracks quota usage with 100% accuracy against actual provider usage.
- **SC-005**: Users can switch between multiple AI tools (Claude Code, Cursor, etc.) without changing gateway configuration.
- **SC-006**: Gateway maintains 99.9% uptime for request routing when at least one coding plan is available.
- **SC-007**: Error messages are actionable and help users resolve issues without external documentation in 90% of cases.

## Assumptions

- Users have valid API keys and subscriptions for their configured coding plans.
- Coding plans expose either OpenAI-compatible or Anthropic-compatible APIs.
- Quota limits are configured manually by users based on their subscription limits.
- Single-user deployment (no multi-tenancy or authentication required for the gateway itself).
- Local deployment (no cloud hosting or distributed architecture required initially).
- Users can provide model lists for each coding plan (auto-discovery is a future enhancement).
# Feature Specification: Model Name Case-Insensitive Matching

**Feature Branch**: `013-model-name-normalization`
**Created**: 2026-03-27
**Status**: Draft
**Input**: User description: "由于不同平台的plan中，对于同一个模型的命名可能存在些许区别，例如：minimax-m2.5和MiniMax-M2.5，实际上是同一个模型。创建一个feature实现这种兼容，使得用户通过网关请求时，设置MiniMax-M2.5或minimax-m2.5，都可以被路由到支持该模型的平台。"

## Clarifications

### Session 2026-03-27

- Q: Model name standardization scope → A: Case normalization + simple aliases (minimax-m2.5 = MiniMax-M2.5, plus common aliases)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Case-Insensitive Model Routing (Priority: P1)

A developer using Claude Code or other AI tools sends a chat completion request with a model name in lowercase (e.g., `minimax-m2.5`). The gateway correctly identifies this as the same model as `MiniMax-M2.5` configured in a coding plan and routes the request to the appropriate provider.

**Why this priority**: This is the core value proposition - enabling seamless cross-platform compatibility without requiring users to match exact case naming conventions used by different providers.

**Independent Test**: Can be fully tested by sending requests with various model name casings and verifying they route to the correct plan that supports the model.

**Acceptance Scenarios**:

1. **Given** a coding plan is configured with model `MiniMax-M2.5`, **When** user sends request with model `minimax-m2.5` (lowercase), **Then** request is routed to that plan successfully
2. **Given** a coding plan is configured with model `claude-sonnet-4-20250514`, **When** user sends request with model `CLAUDE-SONNET-4-20250514` (uppercase), **Then** request is routed to that plan successfully
3. **Given** multiple coding plans support different case variations of the same model, **When** user sends request, **Then** request is routed to a plan that has matching model (case-insensitive)

---

### User Story 2 - Mixed Case Model Names (Priority: P2)

A developer sends a request with a mixed-case model name like `MiniMax-M2.5` or `mInImAx-M2.5`. The gateway normalizes the model name and finds the matching plan.

**Why this priority**: Ensures comprehensive case-insensitive matching covers all variations, not just lowercase/uppercase extremes.

**Independent Test**: Can be tested by sending requests with various case combinations and verifying routing works correctly.

**Acceptance Scenarios**:

1. **Given** plan configured with `gpt-4-turbo`, **When** user sends `GPT-4-Turbo`, **Then** routes correctly
2. **Given** plan configured with `claude-3-opus`, **When** user sends `Claude-3-Opus`, **Then** routes correctly

---

### User Story 3 - No Match Returns Clear Error (Priority: P3)

When a user requests a model that doesn't exist in any configured plan (even after case-insensitive matching), the system returns a clear error message.

**Why this priority**: Provides good user experience by clearly explaining why the request couldn't be routed.

**Independent Test**: Can be tested by requesting a non-existent model and verifying the error message is helpful.

**Acceptance Scenarios**:

1. **Given** no plan supports the requested model (case-insensitive), **When** user sends request, **Then** error message indicates model not found and lists available models

---

### Edge Cases

- What happens when a model name contains numbers and special characters (e.g., `claude-3-5-sonnet-20241022`)?
- How does the system handle empty or malformed model names?
- What if two different plans have models that differ only in case (e.g., `mini-max` vs `MiniMax`)?
- How are common model aliases defined and maintained (e.g., `gpt-4` as alias for `gpt-4-turbo`)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST match model names case-insensitively when routing requests to coding plans
- **FR-002**: System MUST normalize incoming model names before comparison with configured plan models
- **FR-003**: System MUST support all case variations: lowercase, uppercase, title case, mixed case
- **FR-004**: System MUST return clear error when requested model is not found in any plan (case-insensitive)
- **FR-005**: System MUST preserve the original model name in requests forwarded to upstream providers (do not modify upstream request)
- **FR-006**: System MUST support model aliases for common naming variations (e.g., mapping `gpt-4` to configured model)

### Key Entities

- **Model Name**: The identifier for an AI model, which may have different case representations across platforms
- **Coding Plan**: Configuration containing supported models and provider details
- **Model Resolver**: Component responsible for matching requested models to available plans

## Assumptions

- Model names are compared after normalization to lowercase (most common convention)
- Existing plan configurations do not need to be modified to benefit from this feature
- Upstream providers are case-sensitive and require the original model name in requests
- Common model aliases are predefined (e.g., `gpt-4` → `gpt-4-turbo`, `claude-3` → latest claude-3 version)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully route requests using any case variation of a model name (100% of test cases)
- **SC-002**: All existing plan configurations continue to work without modification
- **SC-003**: Error messages clearly indicate when a model is not found, improving user troubleshooting time
- **SC-004**: Implementation adds no measurable latency overhead to request routing (maintains <50ms p95)
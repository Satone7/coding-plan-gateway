# Feature Specification: Enhance Gateway Routing and Load Balancing

**Feature Branch**: `009-enhance-routing-lb`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "Fix request passthrough and implement comprehensive load balancing"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Custom Parameters in Request Passthrough (Priority: P1)

As a developer using the gateway with extended API features, I need custom and provider-specific parameters to pass through the gateway without being dropped, so that I can use the full capabilities of my AI provider.

**Why this priority**: This is a data integrity issue causing silent failures. Clients expect all parameters to be forwarded, and dropping them breaks compatibility with extended API features.

**Independent Test**: Can be fully tested by sending a request with custom parameters through the OpenAI endpoint and verifying they reach the upstream provider.

**Acceptance Scenarios**:

1. **Given** a request to `/v1/chat/completions` with custom parameters (e.g., `logprobs`, `top_logprobs`), **When** the gateway forwards the request to the upstream provider, **Then** all custom parameters are preserved in the forwarded request.
2. **Given** a request with provider-specific parameters (e.g., Kimi-specific or Claude-specific extensions), **When** the gateway processes the request, **Then** these parameters are not stripped or modified.
3. **Given** a request with unknown fields in the Anthropic endpoint `/v1/messages`, **When** the gateway forwards the request, **Then** the behavior matches the OpenAI endpoint (consistent passthrough).

---

### User Story 2 - Consistent Validation Behavior Across Endpoints (Priority: P1)

As a system administrator, I need both OpenAI and Anthropic endpoints to behave consistently regarding unknown field handling, so that I can predict and document the gateway's behavior.

**Why this priority**: Inconsistent behavior causes confusion and makes troubleshooting difficult. Users expect uniform treatment across all API endpoints.

**Independent Test**: Can be fully tested by comparing the forwarded request payload from both endpoints with identical unknown fields.

**Acceptance Scenarios**:

1. **Given** requests to both `/v1/chat/completions` and `/v1/messages` with identical unknown fields, **When** the gateway forwards both requests, **Then** both preserve or drop the fields identically.
2. **Given** the gateway documentation describes it as a "transparent proxy", **When** unknown fields are present in any request, **Then** the gateway behavior is documented and consistent.

---

### User Story 3 - Fair Distribution of Requests Across Plans (Priority: P2)

As a user with multiple coding plan subscriptions, I need the gateway to distribute requests fairly across plans instead of always selecting the plan with the highest quota, so that I can maximize the value of all my subscriptions.

**Why this priority**: The current "always highest quota" selection leads to uneven distribution where one plan is exhausted while others sit idle. This wastes subscription value.

**Independent Test**: Can be fully tested by sending multiple requests for the same model and verifying distribution across available plans.

**Acceptance Scenarios**:

1. **Given** two plans with equal remaining quota supporting the same model, **When** multiple requests arrive for that model, **Then** requests are distributed fairly (not always selecting the same plan).
2. **Given** three plans with similar quota levels, **When** 100 requests arrive over time, **Then** the distribution is reasonably balanced (no single plan receives >80% of requests).
3. **Given** configurable load balancing strategy, **When** the strategy is set to "round-robin", **Then** plans are cycled through in order.

---

### User Story 4 - Prioritize Expiring Plans for Quota Utilization (Priority: P2)

As a user with time-limited subscription plans, I need the gateway to prioritize plans that are expiring soon, so that I can use their remaining quota before they expire and avoid wasting subscription value.

**Why this priority**: This directly impacts the business value of subscriptions. Plans expiring soon with unused quota represent lost value for the user.

**Independent Test**: Can be fully tested by configuring plans with different expiration dates and verifying the selection prioritizes expiring plans.

**Acceptance Scenarios**:

1. **Given** Plan A expires in 2 hours with 50% quota remaining, and Plan B has no expiration with 80% quota remaining, **When** a request arrives, **Then** Plan A is selected first to maximize quota utilization before expiration.
2. **Given** a plan expires today (day 28 of month), **When** the gateway evaluates plans, **Then** this plan receives a higher priority score than plans with longer remaining time.
3. **Given** multiple plans expire on different days of the month, **When** calculating selection scores, **Then** plans closer to their expiration date receive higher priority.

---

### User Story 5 - Balance Load Based on Current Request Rate (Priority: P3)

As a system administrator, I need the gateway to consider current request rates (RPM) when selecting plans, so that no single plan becomes overloaded while others have available capacity.

**Why this priority**: This improves overall system performance and prevents hitting provider rate limits on individual plans.

**Independent Test**: Can be fully tested by sending rapid requests and verifying plans with lower current RPM are preferred.

**Acceptance Scenarios**:

1. **Given** Plan A has processed 50 requests in the last minute and Plan B has processed 10 requests, **When** a new request arrives, **Then** Plan B is preferred to balance the load.
2. **Given** a sliding window of 60 seconds tracks requests per plan, **When** calculating RPM scores, **Then** the score reflects the current load accurately.
3. **Given** two plans with equal quota and expiration, **When** selecting a plan, **Then** the one with lower current RPM is preferred.

---

### Edge Cases

- What happens when a plan expires mid-request? The request should complete, and subsequent requests should not select that plan.
- How does the system handle a month with fewer days than the configured `expiresOn` (e.g., February 30th)? Use the last day of the month.
- What happens when all plans supporting a model are exhausted? Return appropriate error (503 Service Unavailable).
- What happens when RPM tracking data is reset (e.g., server restart)? Start fresh tracking; this is acceptable as historical data is not critical.
- What happens when a plan has `expiresOn: null` (no expiration)? It receives the lowest expiration priority score (10).

## Requirements *(mandatory)*

### Functional Requirements

**Request Passthrough**
- **FR-001**: The OpenAI endpoint `/v1/chat/completions` MUST preserve all unknown fields in request payloads when forwarding to upstream providers.
- **FR-002**: The Anthropic endpoint `/v1/messages` MUST preserve all unknown fields in request payloads when forwarding to upstream providers.
- **FR-003**: Both endpoints MUST have consistent behavior regarding unknown field handling (both preserve or both drop, not mixed).
- **FR-004**: The gateway MUST NOT silently drop custom or provider-specific parameters.

**Load Balancing - Core**
- **FR-005**: The plan selection algorithm MUST support multiple load balancing strategies (at minimum: quota-priority, round-robin, weighted-round-robin, random).
- **FR-006**: The load balancing strategy MUST be configurable (per gateway instance).
- **FR-007**: When using round-robin strategy, the gateway MUST cycle through available plans in order for each model.
- **FR-008**: When using weighted-round-robin strategy, the gateway MUST distribute requests proportionally to configured weights.

**Load Balancing - Multi-Factor Selection**
- **FR-009**: The plan selection algorithm MUST consider three factors with configurable weights: expiration (default 40%), RPM (default 40%), and quota (default 20%).
- **FR-010**: Plans with sooner expiration dates MUST receive higher priority scores to maximize quota utilization before expiration.
- **FR-011**: Plans with lower current request rates (RPM) MUST receive higher priority scores to balance load.
- **FR-012**: Plans with higher remaining quota percentage MUST receive higher priority scores.

**Expiration Configuration**
- **FR-013**: Plans MUST support an optional `expiresOn` field specifying the day of month (1-31) when the plan's quota resets/expires.
- **FR-014**: Plans MUST support an optional `expiresAt` field specifying an exact ISO 8601 datetime for one-time plan expiration.
- **FR-015**: Plans MUST support an optional `weight` field for load balancing weight configuration.
- **FR-016**: When `expiresOn` day doesn't exist in the current month (e.g., 31st in February), the system MUST use the last day of the month.

**RPM Tracking**
- **FR-017**: The gateway MUST track requests per plan using a sliding window of the last 60 seconds.
- **FR-018**: RPM (Requests Per Minute) MUST be calculated as the count of requests in the sliding window.

### Key Entities

- **Plan Configuration**: Extended to include `expiresOn` (day of month, optional), `expiresAt` (ISO datetime, optional), and `weight` (integer, optional) fields.
- **Quota State**: Existing entity tracking used/limit quota per plan.
- **RPM Tracker**: New entity tracking request timestamps per plan using a sliding window.
- **Load Balancing Config**: Configuration specifying the strategy and factor weights for plan selection.
- **Plan Score**: Computed score per candidate plan based on weighted factors (expiration, RPM, quota).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unknown fields in OpenAI-format requests are preserved in forwarded requests (verified by test suite).
- **SC-002**: 100% of unknown fields in Anthropic-format requests are preserved in forwarded requests (verified by test suite).
- **SC-003**: Both endpoints exhibit identical passthrough behavior (consistency verified by comparison tests).
- **SC-004**: When multiple plans with equal quota exist, request distribution variance is less than 20% from ideal fair distribution.
- **SC-005**: Plans expiring within 24 hours are selected at least 90% of the time when they have sufficient remaining quota.
- **SC-006**: Plans with lower current RPM receive higher selection priority when other factors are equal.
- **SC-007**: All load balancing strategies (quota-priority, round-robin, weighted-round-robin, random) pass their respective test suites.
- **SC-008**: RPM calculation accurately reflects requests in the last 60-second sliding window.

## Assumptions

- The gateway processes requests sequentially for the same model; concurrent requests may see slight variation in RPM values due to race conditions (acceptable).
- Default weight distribution (40% expiration, 40% RPM, 20% quota) is suitable for most use cases; users can configure different weights if needed.
- The sliding window RPM tracking may have minor accuracy variations during high load (acceptable trade-off for performance).
- When no `expiresOn` or `expiresAt` is configured, the plan is treated as "no expiration" with the lowest expiration priority.
- Day-of-month expiration (e.g., 28th) resets quota tracking but does not automatically modify the plan configuration file.
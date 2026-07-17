# Coding Plan Gateway - Architecture Overview

**Version**: 1.0 | **Date**: 2026-03-20 | **Status**: Active

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview (C4)](#2-system-overview-c4)
3. [Deployment Summary](#3-deployment-summary)
4. [Architecture Decisions (ADRs)](#4-architecture-decisions-adrs)
5. [Quality Attributes](#5-quality-attributes)
6. [Risks & Technical Debt](#6-risks--technical-debt)

---

## 1. Executive Summary

- **What**: A gateway service that provides a unified API endpoint for managing multiple AI coding plan subscriptions. Routes requests to appropriate providers based on model availability and quota, exposing OpenAI and Anthropic compatible APIs.
- **Why**: Users with multiple AI subscriptions need seamless access without manual provider switching. The gateway maximizes quota utilization across subscriptions while providing transparent integration with existing AI tools.
- **Core Tech**: API: Node.js/Fastify, Config: YAML/JSON file, Store: In-memory with file persistence, Infra: Local Docker deployment

---

## 2. System Overview (C4)

### 2.1 Context

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────┐
│  Developer  │────▶│ Coding Plan Gateway │────▶│  Kimi    │
└─────────────┘     │                     │     └──────────┘
                    │                     │     ┌──────────┐
                    │  - Route by model   │────▶│  Claude  │
                    │  - Track quota      │     └──────────┘
                    │  - Load balance     │     ┌──────────┐
                    │                     │────▶│ OpenAI   │
                    └─────────────────────┘     └──────────┘
```

**System Responsibilities**:
- Accept API requests in OpenAI or Anthropic format
- Route requests to appropriate coding plan based on model and quota
- Track quota usage across all configured coding plans
- Provide configuration management interface
- Return responses in the same format as the request

### 2.2 Containers

| Container | Technology | Purpose |
|-----------|------------|---------|
| Gateway API | Node.js + Fastify | Main application handling request routing, quota tracking, and API compatibility |
| Config Store | YAML/JSON file | Persistent storage for coding plan configurations |
| Quota Cache | In-memory Map | Fast access to current quota state with periodic persistence |
| Health Check | Built-in endpoint | Liveness and readiness probes for monitoring |

### 2.3 Components (Key Interfaces)

```
┌─────────────────────────────────────────────────────────────┐
│                      Gateway API                              │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐   │
│  │ OpenAI      │    │   Request    │    │   Request    │   │
│  │ Endpoint    │───▶│   Router     │───▶│   Proxy      │───▶ Upstream
│  │ Anthropic   │    │              │    │              │       Providers
│  │ Endpoint    │    │  ┌────────┐  │    │              │
│  └─────────────┘    │  │ Model  │  │    └──────────────┘
│                     │  │Resolver│  │
│                     │  └────┬───┘  │
│                     │  ┌────┴───┐  │
│                     │  │ Quota  │  │
│                     │  │Manager │  │
│                     │  └───┬────┘  │
│                     │  ┌───┴───┐   │
│                     │  │ Plan  │   │
│                     │  │Selector│  │
│                     │  └───────┘  │
│                     └──────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Deployment Summary

- **Runtime**: Docker container on local machine or bare-metal Node.js process
- **Ingress**: HTTP on configurable port (default: 8080)
- **Secrets/Config**: Environment variables for API keys, YAML file for plan configs
- **CI/CD**: Manual deployment, npm scripts for start/stop/reload

**Deployment Commands**:
- `npm start` - Start the gateway
- `npm run reload` - Hot-reload configuration
- `npm run config validate` - Validate configuration file
- `npm run quota reset <plan-id>` - Reset quota for a plan

---

## 4. Architecture Decisions (ADRs)

| ID | Title | Status | Date |
|----|-------|--------|------|
| ADR-001 | Monolithic Single-Process Architecture | Accepted | 2026-03-20 |
| ADR-002 | File-Based Configuration Storage | Accepted | 2026-03-20 |
| ADR-003 | In-Memory Quota Tracking with Persistence | Accepted | 2026-03-20 |
| ADR-004 | Dual API Format Support (OpenAI + Anthropic) | Accepted | 2026-03-20 |
| ADR-005 | Quota-Based Load Balancing | Accepted | 2026-03-20 |

### ADR-001: Monolithic Single-Process Architecture

**Decision**: Implement as a single Node.js process with all components in-memory.

**Consequences**:
- Simpler deployment and debugging
- Lower resource overhead
- Suitable for single-user local deployment
- Cannot scale horizontally (acceptable for this use case)

### ADR-002: File-Based Configuration Storage

**Decision**: Store configuration in a YAML file with hot-reload support.

**Consequences**:
- Human-readable and editable configuration
- Version-controllable
- Simple backup and restore
- No database dependency
- Hot-reload enables updates without restart

### ADR-003: In-Memory Quota Tracking with Persistence

**Decision**: Maintain quota state in-memory with periodic persistence to file.

**Consequences**:
- Fast quota lookups (<1ms)
- Potential loss of recent quota updates on crash (acceptable for tracking)
- Simple implementation without database
- Manual quota reset available for correction

### ADR-004: Dual API Format Support (OpenAI + Anthropic)

**Decision**: Provide both `/v1/chat/completions` (OpenAI format) and `/v1/messages` (Anthropic format) endpoints.

**Consequences**:
- Maximum tool compatibility
- Request/response transformation required
- Both streaming and non-streaming support needed
- No modification required in existing AI tools

### ADR-005: Quota-Based Load Balancing

**Decision**: Select the coding plan with the highest remaining quota.

**Consequences**:
- Maximizes total quota utilization
- Natural load distribution across plans
- Prevents exhausting a single plan
- Configurable quota limits allow user control

---

## 5. Quality Attributes

### Performance

- **Targets**: <50ms routing overhead (p95), streaming response passthrough <10ms latency
- **Strategies**:
  - In-memory quota cache for O(1) lookups
  - Streaming response passthrough without buffering
  - Minimal request transformation
  - Connection pooling to upstream providers
  - No synchronous disk I/O in request path

### Scalability

- **Targets**: Support 10+ coding plans, 100+ concurrent requests
- **Strategies**:
  - Stateless request handling
  - Async I/O for all operations
  - Event-driven architecture (Node.js)
  - Single-threaded event loop sufficient for single-user load

### Availability & Reliability

- **Targets**: 99.9% uptime when at least one coding plan is available
- **Strategies**:
  - Automatic failover to alternative plans on provider error
  - Health check endpoint for monitoring
  - Graceful degradation when providers unavailable
  - Configuration validation on startup
  - Circuit breaker pattern for failing providers

### Security

- **Baseline**:
  - API keys encrypted at rest (AES-256)
  - TLS for all upstream connections
  - No external network exposure (localhost only)
  - Input validation on all endpoints
- **Scans**: Dependency vulnerability scanning in CI, SAST on code changes

### Maintainability & Observability

- **Tests**: Unit tests >80% coverage, integration tests for routing, E2E tests for API compatibility
- **Telemetry**:
  - Structured JSON logs with request tracing
  - Per-request timing metrics
  - Quota usage metrics
  - Provider response times
  - Error rate tracking

---

## 6. Risks & Technical Debt

| ID | Risk/Debt | Impact | Mitigation/Plan |
|----|-----------|--------|-----------------|
| R-001 | Provider API rate limits | High | Implement request queuing, expose rate limit errors to user |
| R-002 | Upstream provider outages | High | Circuit breaker + failover to alternative plans |
| R-003 | Quota sync drift | Medium | Allow manual quota reset, log quota usage for verification |
| R-004 | API key compromise | High | Encrypt keys at rest, support env var injection, document key rotation |
| R-005 | Configuration file corruption | Medium | Validate on load, create backups, provide recovery tooling |
| TD-001 | No multi-tenancy | Low | Acceptable for initial scope; future enhancement if needed |
| TD-002 | Manual model list configuration | Low | Future: auto-discovery from provider APIs |
| TD-003 | No request queuing | Medium | Future: implement queuing when quota exhausted |

---

## References

- Full coding standards: `docs/standards.md`
- Project ground-rules: `memory/ground-rules.md`
- Feature specifications: `specs/001-coding-plan-gateway/spec.md`

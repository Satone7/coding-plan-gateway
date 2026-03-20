# ADR-001: Monolithic Single-Process Architecture

## Status

Accepted

## Context

The Coding Plan Gateway serves a single user locally and doesn't require horizontal scaling or high availability across machines. The primary use case is a developer running the gateway on their local machine to manage their AI coding plan subscriptions.

Key considerations:
- Single-user deployment model
- Local machine execution
- No multi-tenancy requirements
- Low to moderate request volume
- Simplicity preferred over enterprise features

## Decision

Implement the gateway as a single Node.js process with all components in-memory.

## Rationale

1. **Simplicity**: A monolith is easier to develop, test, deploy, and debug
2. **Resource efficiency**: No overhead from inter-service communication
3. **Appropriate scale**: Single-user use case doesn't need distribution
4. **Fast development**: Single codebase, no service boundaries to manage
5. **Easy debugging**: All state in one process, straightforward logging

## Alternatives Considered

### Microservices Architecture
- **Pros**: Independent scaling, technology flexibility
- **Cons**: Over-engineering for single-user use case, operational complexity
- **Verdict**: Rejected - not justified for this scale

### Multi-Process with Message Queue
- **Pros**: Better isolation, async processing
- **Cons**: Additional infrastructure, complexity
- **Verdict**: Rejected - unnecessary for request volumes

## Consequences

### Positive
- Simpler deployment (single container or process)
- Lower resource overhead
- Easier local development and testing
- Faster debugging with all state accessible
- No network latency between components

### Negative
- Cannot scale horizontally (acceptable for single-user)
- Single point of failure (acceptable for local deployment)
- All components share same process resources

### Neutral
- If multi-tenancy is needed in future, significant refactoring required
- Migration path to microservices would require decomposition

## References

- Feature specification: `specs/001-coding-plan-gateway/spec.md`
- Ground-rules: `memory/ground-rules.md`
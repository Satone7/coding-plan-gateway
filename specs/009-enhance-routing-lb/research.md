# Research: Enhance Gateway Routing and Load Balancing

**Feature**: 009-enhance-routing-lb
**Date**: 2026-03-26
**Status**: Complete

## Research Topics

### R1: Zod Passthrough Best Practices

**Question**: How to properly implement Zod passthrough for transparent proxy behavior?

**Decision**: Use `.passthrough()` method on Zod object schemas.

**Rationale**:
- Zod's default behavior is to strip unknown keys
- `.passthrough()` preserves unknown keys in parsed output
- `.strict()` would throw errors on unknown keys (not desired for transparent proxy)
- Anthropic endpoint already uses this pattern successfully

**Alternatives Considered**:
| Approach | Rejected Because |
|----------|------------------|
| `.strict()` | Throws errors on unknown fields, breaking compatibility |
| Manual field copying | Error-prone, maintenance burden |
| Raw JSON passthrough | Loses validation of known fields |

**Architecture Alignment**: Consistent with ADR-004 (Dual API Format Support) - both endpoints now preserve all fields.

**Implementation Reference**:
```typescript
// Before
const schema = z.object({ model: z.string(), ... });

// After
const schema = z.object({ model: z.string(), ... }).passthrough();
```

---

### R2: Load Balancing Strategy Patterns

**Question**: What is the best pattern for implementing multiple load balancing strategies?

**Decision**: Strategy pattern with a selector factory.

**Rationale**:
- Each strategy is isolated and testable
- Easy to add new strategies without modifying existing code
- Configuration-driven selection
- Follows Open-Closed Principle

**Alternatives Considered**:
| Approach | Rejected Because |
|----------|------------------|
| Switch statement in selectBestPlan | Hard to test, violates OCP |
| Chain of responsibility | Over-engineered for this use case |
| Random selection only | Doesn't meet multi-factor requirement |

**Architecture Alignment**: Aligns with ADR-005 (Quota-Based Load Balancing) extended to support multiple strategies.

**Strategy Implementations**:

| Strategy | Algorithm | Use Case |
|----------|-----------|----------|
| quota-priority | Highest remaining quota first | Current behavior, maximize utilization |
| round-robin | Cycle through plans in order | Fair distribution |
| weighted-round-robin | Cycle with weight consideration | Prioritize premium plans |
| random | Uniform random selection | Simple distribution |

---

### R3: RPM Tracking Implementation

**Question**: How to efficiently track requests per minute with minimal overhead?

**Decision**: Time-bucketed sliding window (6 buckets of 10 seconds).

**Rationale**:
- Fixed memory footprint: 6 integers per plan
- O(1) update and query complexity
- 10-second granularity is sufficient for load balancing decisions
- No external dependencies (Redis, etc.)

**Alternatives Considered**:
| Approach | Rejected Because |
|----------|------------------|
| Exact sliding window | Requires storing all timestamps, O(n) memory |
| Redis-based tracking | Adds external dependency, unnecessary for single-user |
| Fixed window (reset every 60s) | Burst at window boundaries |

**Architecture Alignment**: Aligns with ADR-003 (In-Memory Quota Tracking) - same pattern for RPM.

**Implementation Details**:
```typescript
interface RpmBucket {
  timestamp: number;  // Unix timestamp divided by 10
  count: number;
}

class RpmTracker {
  private buckets: Map<string, RpmBucket[]>; // 6 buckets per plan

  // O(1) operations
  recordRequest(planId: string): void;
  getRpm(planId: string): number;
}
```

---

### R4: Expiration Score Calculation

**Question**: How to score plans based on expiration for prioritization?

**Decision**: Tiered scoring system based on time remaining.

**Rationale**:
- Simple to implement and understand
- Predictable behavior
- Covers all edge cases
- Configurable weights allow tuning

**Score Calculation**:
```typescript
function calculateExpirationScore(expiresAt: Date | null): number {
  if (!expiresAt) return 10; // No expiration = lowest priority

  const hoursRemaining = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);

  if (hoursRemaining <= 0) return 0;  // Expired
  if (hoursRemaining < 1) return 100; // < 1 hour
  if (hoursRemaining < 24) return 90; // 1-24 hours
  if (hoursRemaining < 168) return 60; // 1-7 days
  if (hoursRemaining < 720) return 30; // 7-30 days
  return 20; // > 30 days
}
```

**Alternatives Considered**:
| Approach | Rejected Because |
|----------|------------------|
| Linear scoring | Doesn't emphasize "expiring soon" enough |
| Exponential decay | More complex, harder to tune |
| Binary (expired/active) | Loses priority nuance |

---

### R5: Multi-Factor Score Weighting

**Question**: How to combine expiration, RPM, and quota into a single score?

**Decision**: Weighted sum with configurable weights (default: 40% expiration, 40% RPM, 20% quota).

**Rationale**:
- Simple and interpretable
- Default weights prioritize expiration and load balancing
- Users can adjust for their use case
- Easy to implement and test

**Score Calculation**:
```typescript
interface FactorWeights {
  expiration: number;  // default 0.4
  rpm: number;         // default 0.4
  quota: number;       // default 0.2
}

function calculateTotalScore(
  plan: CodingPlan,
  rpm: number,
  quotaState: QuotaState,
  weights: FactorWeights
): number {
  const expirationScore = calculateExpirationScore(plan.expiresAt);
  const rpmScore = calculateRpmScore(rpm, maxRpm); // Inverse: lower RPM = higher score
  const quotaScore = (quotaState.limit - quotaState.used) / quotaState.limit * 100;

  return (
    expirationScore * weights.expiration +
    rpmScore * weights.rpm +
    quotaScore * weights.quota
  );
}
```

**Validation**:
- Weights must sum to 1.0
- Each weight must be >= 0 and <= 1
- Default weights validated against use cases in issues.md

---

## Summary

All research questions resolved. Key decisions:

| Topic | Decision | Impact |
|-------|----------|--------|
| R1: Passthrough | Use Zod `.passthrough()` | Simple one-line fix |
| R2: LB Strategies | Strategy pattern | Extensible, testable |
| R3: RPM Tracking | Time-bucketed sliding window | O(1) operations, fixed memory |
| R4: Expiration Scoring | Tiered scoring (0-100) | Predictable, covers all cases |
| R5: Multi-Factor | Weighted sum | Configurable, simple |

**Ready for Phase 1**: Design & Contracts
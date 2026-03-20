# ADR-003: In-Memory Quota Tracking with Persistence

## Status

Accepted

## Context

The gateway needs to track quota usage for each coding plan to:
- Make routing decisions based on remaining quota
- Provide usage statistics to users
- Prevent routing to exhausted plans

Requirements:
- Fast lookups for routing decisions (<1ms)
- Persistence across restarts
- Support for manual quota reset
- Accuracy within acceptable tolerance

## Decision

Maintain quota state in-memory with periodic persistence to a file.

## Rationale

1. **Performance**: In-memory lookups are O(1), enabling fast routing decisions
2. **Simplicity**: No database dependency required
3. **Acceptable trade-off**: Minor quota drift on crash is acceptable for this use case
4. **Manual correction**: Users can reset quota if tracking drifts

## Persistence Strategy

- **Write**: Persist quota state to file every 60 seconds (configurable)
- **Read**: Load quota state on startup
- **Sync**: Immediate persistence on manual quota reset

## Alternatives Considered

### Real-time Database (Redis/PostgreSQL)
- **Pros**: Strong consistency, transactions, durability
- **Cons**: Additional infrastructure, complexity
- **Verdict**: Rejected - unnecessary for single-user local deployment

### Event Sourcing
- **Pros**: Complete audit trail, replay capability
- **Cons**: Complexity, storage overhead
- **Verdict**: Rejected - over-engineering for current needs

### No Persistence (Stateless)
- **Pros**: Simplest implementation
- **Cons**: Quota lost on restart, poor UX
- **Verdict**: Rejected - violates requirement for tracking

## Consequences

### Positive
- Fast quota lookups (<1ms)
- Simple implementation
- No external dependencies
- Low resource usage

### Negative
- Potential loss of recent quota updates on crash (up to 60s of data)
- No distributed consistency (not needed for single-user)

### Mitigations

1. **Crash recovery**: On restart, load persisted state; accept minor drift
2. **Manual reset**: `POST /api/quota/:planId/reset` endpoint for correction
3. **Logging**: All quota changes logged for audit trail
4. **Sync interval**: Configurable `QUOTA_SYNC_INTERVAL` for trade-off tuning

## Implementation

```typescript
interface QuotaStore {
  plans: Map<string, {
    limit: number;
    used: number;
    lastUpdated: Date;
  }>;

  // Operations
  getRemaining(planId: string): number;
  consume(planId: string, amount: number): boolean;
  reset(planId: string): void;
  persist(): Promise<void>;
  load(): Promise<void>;
}
```

## References

- FR-005: System MUST track usage quota for each coding plan
- FR-006: System MUST prioritize coding plans with higher remaining quota
- FR-014: System MUST support manual quota reset functionality
- SC-004: System correctly tracks quota usage with 100% accuracy
# ADR-005: Quota-Based Load Balancing

## Status

Accepted

## Context

When multiple coding plans support the same model, the gateway must decide which plan to use for a given request. The selection strategy impacts:

- User quota utilization across subscriptions
- Request distribution among providers
- User experience when quotas are exhausted

## Decision

Select the coding plan with the highest remaining quota when multiple plans support the requested model.

## Rationale

1. **Maximizes utilization**: Uses subscriptions proportionally to available quota
2. **Natural distribution**: Spreads load across plans automatically
3. **Simple to understand**: Clear, predictable behavior
4. **User control**: Users can set quota limits to influence routing

## Selection Algorithm

```
1. Filter plans that support the requested model
2. Filter out plans with zero remaining quota (optional: allow exhausted plans)
3. Sort by remaining quota (highest first)
4. Select top plan
5. If multiple plans have same quota, use round-robin or first available
```

## Alternatives Considered

### Round-Robin
- **Pros**: Even distribution
- **Cons**: Doesn't account for quota differences
- **Verdict**: Rejected - wastes quota on exhausted plans

### Least Connections
- **Pros**: Balances active load
- **Cons**: Doesn't account for quota limits
- **Verdict**: Rejected - not applicable to request/response model

### Weighted Random
- **Pros**: Probabilistic distribution
- **Cons**: Non-deterministic, harder to reason about
- **Verdict**: Rejected - quota-based is more predictable

### Priority-Based
- **Pros**: User control over preference
- **Cons**: Requires manual configuration
- **Verdict**: Considered as future enhancement

## Consequences

### Positive
- Maximizes total quota utilization
- Automatic load distribution
- No manual configuration required
- Predictable behavior

### Negative
- May concentrate load on one provider temporarily
- Doesn't consider provider latency or reliability
- No user override for specific requests

### Future Enhancements

1. **Latency-aware routing**: Prefer faster providers when quota is similar
2. **Priority configuration**: Allow users to set preferred providers
3. **Cost optimization**: Route to cheaper providers when available
4. **Health-based weighting**: Reduce selection of unhealthy providers

## Implementation

```typescript
interface PlanSelector {
  select(
    model: string,
    plans: CodingPlan[],
    quotaStore: QuotaStore
  ): CodingPlan | null;
}

class QuotaBasedPlanSelector implements PlanSelector {
  select(model: string, plans: CodingPlan[], quotaStore: QuotaStore): CodingPlan | null {
    // Filter plans supporting the model
    const supportingPlans = plans.filter(p => p.models.includes(model));

    if (supportingPlans.length === 0) {
      return null;
    }

    // Sort by remaining quota (descending)
    return supportingPlans.sort((a, b) => {
      const remainingA = quotaStore.getRemaining(a.id);
      const remainingB = quotaStore.getRemaining(b.id);
      return remainingB - remainingA;
    })[0];
  }
}
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No plans support model | Return error: "No provider available for model X" |
| All supporting plans exhausted | Return error: "All providers for model X have exhausted quota" |
| Single plan available | Use that plan regardless of quota |
| Plans with same quota | Use first in configuration order (deterministic) |

## References

- FR-004: System MUST route requests to coding plan supporting the model
- FR-006: System MUST prioritize plans with higher remaining quota
- FR-007: System MUST return clear error when no plan supports model
- User Story 2: Route Requests by Model
- User Story 3: Track and Prioritize by Quota
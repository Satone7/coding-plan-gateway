# Quickstart: Enhance Gateway Routing and Load Balancing

**Feature**: 009-enhance-routing-lb

## Overview

This feature adds:
1. **Request Passthrough** - All unknown fields are now preserved
2. **Load Balancing Strategies** - Choose from quota-priority, round-robin, weighted-round-robin, or random
3. **Multi-Factor Selection** - Plans scored by expiration, RPM, and quota

## Quick Configuration

### 1. Enable Round-Robin Load Balancing

```yaml
# config.yaml
loadBalancing:
  strategy: "round-robin"
```

### 2. Add Plan Expiration

```yaml
plans:
  - id: "plan-1"
    name: "Monthly Plan"
    # ... existing fields ...
    expiresOn: 28  # Expires on 28th of each month
    weight: 2      # Higher priority
```

### 3. Set Exact Expiration Date

```yaml
plans:
  - id: "plan-2"
    name: "Trial Plan"
    # ... existing fields ...
    expiresAt: "2026-04-30T23:59:59Z"  # One-time expiration
```

## Strategy Comparison

| Strategy | Behavior | Best For |
|----------|----------|----------|
| `quota-priority` | Select plan with most remaining quota | Maximizing utilization |
| `round-robin` | Cycle through plans evenly | Fair distribution |
| `weighted-round-robin` | Cycle proportionally to weights | Prioritizing premium plans |
| `random` | Random selection | Simple distribution |

## Multi-Factor Scoring

Default weights (configurable):
- **Expiration**: 40% - Prioritize plans expiring soon
- **RPM**: 40% - Balance load across plans
- **Quota**: 20% - Consider remaining capacity

```yaml
loadBalancing:
  strategy: "round-robin"
  factorWeights:
    expiration: 0.5  # Increase expiration priority
    rpm: 0.3
    quota: 0.2
```

## Verification

### Test Passthrough

```bash
# Send request with custom field
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "custom_field": "should_be_preserved"
  }'

# Check logs to verify custom_field was forwarded
```

### Test Load Balancing

```bash
# Send multiple requests and observe distribution
for i in {1..10}; do
  curl -X POST http://localhost:8080/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Test"}]}'
done

# Check quota usage distribution
curl http://localhost:8080/api/plans
```

## Migration Notes

- **Backward Compatible**: All new config fields are optional
- **No Migration Required**: Existing configurations work unchanged
- **Default Behavior**: Without LB config, uses existing quota-priority strategy
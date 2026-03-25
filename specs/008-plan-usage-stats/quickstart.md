# Quickstart: Plan Usage Statistics

**Feature**: 008-plan-usage-stats
**Date**: 2026-03-25

## Overview

This feature enhances the plan usage tracking system with daily records, manual adjustment capabilities, and fixes the existing usage report command.

## Quick Commands

### View Plan Usage Report

```bash
# View usage for a specific plan
cpg usage-report --plan 550e8400-e29b-41d4-a716-446655440000

# View usage with date range
cpg usage-report --plan 550e8400-e29b-41d4-a716-446655440000 --from 2026-03-01 --to 2026-03-25

# JSON output
cpg usage-report --plan 550e8400-e29b-41d4-a716-446655440000 --json
```

### List Plans with Usage Summary

```bash
# List all plans with usage statistics
cpg plan list
```

### Adjust Plan Usage

```bash
# Set usage to exact count
cpg plan set-usage --id 550e8400-e29b-41d4-a716-446655440000 --count 100

# Set usage as percentage of limit
cpg plan set-usage --id 550e8400-e29b-41d4-a716-446655440000 --percent 75
```

### View API Key Usage (Existing, Fixed)

```bash
# View API key usage report
cpg usage-report

# With filters
cpg usage-report --key-id 550e8400-e29b-41d4-a716-446655440000 --from 2026-03-01 --to 2026-03-25
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans/{planId}/usage` | Get plan usage report |
| POST | `/api/plans/{planId}/usage/adjust` | Adjust plan usage |
| GET | `/api/plans/{planId}/usage/history` | Get adjustment history |
| GET | `/api/plans/usage/summary` | Get all plans usage summary |

## Example API Calls

### Get Plan Usage Report

```bash
curl "http://localhost:8080/api/plans/550e8400-e29b-41d4-a716-446655440000/usage?from=2026-03-01&to=2026-03-25"
```

Response:
```json
{
  "data": {
    "planId": "550e8400-e29b-41d4-a716-446655440000",
    "planName": "Claude Pro",
    "totalRequests": 450,
    "limit": 1000,
    "remaining": 550,
    "percentage": 45,
    "dateRange": {
      "start": "2026-03-01",
      "end": "2026-03-25"
    },
    "dailyBreakdown": [
      {"date": "2026-03-25", "requestCount": 42},
      {"date": "2026-03-24", "requestCount": 38}
    ],
    "quotaPeriod": "monthly",
    "resetAt": "2026-04-01T00:00:00Z"
  },
  "meta": {
    "requestId": "req-uuid",
    "timestamp": "2026-03-25T10:30:00Z"
  }
}
```

### Adjust Usage by Count

```bash
curl -X POST "http://localhost:8080/api/plans/550e8400-e29b-41d4-a716-446655440000/usage/adjust" \
  -H "Content-Type: application/json" \
  -d '{"count": 100}'
```

Response:
```json
{
  "data": {
    "planId": "550e8400-e29b-41d4-a716-446655440000",
    "oldValue": 50,
    "newValue": 100,
    "adjustmentId": "adj-uuid"
  },
  "meta": {
    "requestId": "req-uuid",
    "timestamp": "2026-03-25T10:30:00Z"
  }
}
```

### Adjust Usage by Percentage

```bash
curl -X POST "http://localhost:8080/api/plans/550e8400-e29b-41d4-a716-446655440000/usage/adjust" \
  -H "Content-Type: application/json" \
  -d '{"percent": 75}'
```

Response includes warning if usage exceeds limit:
```json
{
  "data": {
    "planId": "550e8400-e29b-41d4-a716-446655440000",
    "oldValue": 50,
    "newValue": 750,
    "adjustmentId": "adj-uuid",
    "warning": "Usage exceeds quota limit of 500. Current usage: 750 (150%)"
  },
  "meta": {
    "requestId": "req-uuid",
    "timestamp": "2026-03-25T10:30:00Z"
  }
}
```

## Data Files

| File | Purpose | Retention |
|------|---------|-----------|
| `plan-usage-data.json` | Daily usage records per plan | 90 days |
| `usage-adjustment-history.json` | Manual adjustment audit trail | Unlimited |

## Common Workflows

### Sync Usage with Provider

If the gateway's tracked usage drifts from actual provider usage:

1. Check provider dashboard for actual usage count
2. Run `cpg plan set-usage --id <plan-id> --count <actual-count>`
3. View adjustment history: `GET /api/plans/{planId}/usage/history`

### Monitor Subscription Utilization

1. Run `cpg plan list` to see all plans with usage summary
2. Identify plans approaching limits
3. Plan subscription renewals or upgrades

### Debug Usage Tracking

1. Check daily breakdown: `cpg usage-report --plan <id>`
2. Review adjustment history for discrepancies
3. Verify quota reset schedule matches subscription cycle
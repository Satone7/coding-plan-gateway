# Quickstart: Fix Usage Tracking Issues

This guide demonstrates the fixed usage tracking behavior.

## Prerequisites

- Node.js 20+ LTS
- Built project (`npm run build`)
- Configured `config.yaml` with at least one plan

## Issue 001: expiresOn Reset Date

### Before Fix

```bash
# config.yaml has expiresOn: 27
cpg usage-report --plan 1

# Output showed incorrect reset date:
# Resets: 2026-04-01 00:00:00  (always 1st of month)
```

### After Fix

```bash
# config.yaml
cat > config.yaml << 'EOF'
version: "1.0"
plans:
  - id: 1
    name: "Test Plan"
    baseUrl: "https://api.example.com"
    apiKey: "test-key"
    models: ["test-model"]
    quota:
      limit: 90000
      period: "monthly"
      expiresOn: 27
    timeout: 180000
    status: "active"
EOF

# Run usage report
cpg usage-report --plan 1

# Output now shows correct reset date:
# Resets: 2026-03-27 00:00:00  (if today < 27th)
# Resets: 2026-04-27 00:00:00  (if today >= 27th)
```

## Issue 002: set-usage Sync

### Before Fix

```bash
# Set usage to 100
cpg plan set-usage --id 1 --count 100

# Usage report showed 100
cpg usage-report --plan 1
# Used: 100

# But routing used different value (stale QuotaManager.used)
# Server continued routing requests as if usage was still 50
```

### After Fix

```bash
# Start server
npm run start &

# Make 50 requests (usage = 50)

# Set usage to 100
cpg plan set-usage --id 1 --count 100

# CLI syncs with running server automatically
# Output:
# Adjustment ID: 550e8400-e29b-41d4-a716-446655440000
# Old Value: 50
# New Value: 100
# Synced with running server: true

# Both report and routing now show 100
cpg usage-report --plan 1
# Used: 100, Remaining: 89900

# New requests increment from 100
# Make 5 requests through API...
cpg usage-report --plan 1
# Used: 105
```

## Verification Commands

### Test expiresOn

```bash
# Test with different expiresOn values
cpg plan set-usage --id 1 --count 0

# Check February edge case (expiresOn: 31)
# Should show Feb 28 or 29 as reset date
cpg usage-report --plan 1
```

### Test set-usage Sync

```bash
# With server running
npm run start &

# Set usage
cpg plan set-usage --id 1 --count 500

# Verify sync
curl http://localhost:8080/api/admin/plans/1/usage

# Check QuotaManager state
curl http://localhost:8080/api/admin/quota/1
```

### Test CLI-Only (Server Not Running)

```bash
# Stop server
pkill -f "node.*index.js"

# Set usage
cpg plan set-usage --id 1 --count 200

# Start server
npm run start &

# Verify usage persisted
cpg usage-report --plan 1
# Should show 200 (loaded from persistent store)
```
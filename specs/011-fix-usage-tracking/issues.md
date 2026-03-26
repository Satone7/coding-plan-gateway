# Known Issues

## Issue 001: expiresOn configuration not respected in usage-report command

### Summary
The `expiresOn` field in plan configuration is not used when calculating the quota reset date in the `cpg usage-report --plan <id>` command output. The reset date always defaults to the 1st of the next month for monthly plans, regardless of the `expiresOn` setting.

### Expected Behavior
When a plan has `expiresOn: 27` configured, the quota should reset on the 27th of each month. The usage report should display:
```
Resets: 2026-03-27 00:00:00  (if today is before the 27th)
Resets: 2026-04-27 00:00:00  (if today is on or after the 27th)
```

### Actual Behavior
The usage report always shows:
```
Resets: 2026-04-01 00:00:00
```

### Root Cause
1. **`PlanInfo` interface doesn't include `expiresOn`** - Located in `src/services/plan-usage-tracker.ts:49-56`:
   ```typescript
   interface PlanInfo {
     id: number;
     name: string;
     quota: {
       limit: number;
       period: 'daily' | 'monthly' | 'total';
       // Missing: expiresOn?: number;
     };
   }
   ```

2. **`calculateResetAt` method ignores `expiresOn`** - Located in `src/services/plan-usage-tracker.ts:293-318`:
   - Method only accepts `period` parameter
   - For monthly period, it always returns the 1st of next month
   - Does not use the `calculateEffectiveExpiration` utility from `src/utils/expiration.ts`

3. **`getUsageReport` method doesn't pass `expiresOn`** - Located in `src/services/plan-usage-tracker.ts:232-288`:
   - Creates a report with `resetAt` from `calculateResetAt(planInfo.quota.period)`
   - The plan's `expiresOn` is available but not passed to the calculation

### Minimal Reproduction

1. Create a config.yaml with `expiresOn` set:
   ```yaml
   version: "1.0"
   plans:
     - id: 1
       name: "Test Plan"
       baseUrl: "https://api.example.com"
       apiKey: "test-key"
       models:
         - "test-model"
       quota:
         limit: 90000
         period: "monthly"
         expiresOn: 27
       timeout: 180000
       status: "active"
   ```

2. Run the usage report command:
   ```bash
   cpg usage-report --plan 1
   ```

3. Observe the output shows `Resets: <next-month>-01 00:00:00` instead of the 27th.

### Related Code
- `src/types/coding-plan.ts:77` - `expiresOn` is correctly defined in `CodingPlan` interface
- `src/utils/expiration.ts:30-45` - `calculateEffectiveExpiration` utility exists and handles `expiresOn` correctly
- `src/services/plan-usage-tracker.ts:293-318` - `calculateResetAt` needs to be updated or replaced

### Suggested Fix
Option A: Extend `PlanInfo.quota` to include `expiresOn` and update `calculateResetAt`:
```typescript
interface PlanInfo {
  id: number;
  name: string;
  quota: {
    limit: number;
    period: 'daily' | 'monthly' | 'total';
    expiresOn?: number;
  };
}
```

Option B: Use the existing `calculateEffectiveExpiration` utility from `src/utils/expiration.ts` instead of `calculateResetAt`.

### Impact
- Low severity - display issue only
- Affects CLI usage-report output
- Does not affect actual quota enforcement or plan selection

---

## Issue 002: set-usage command does not sync with QuotaManager

### Summary
The `cpg plan set-usage` command only updates `PlanUsageTracker` data, but does not sync with `QuotaManager`. This causes two problems:
1. New requests after `set-usage` will increment on top of the adjusted value, not from zero
2. `QuotaManager.hasRemainingQuota()` uses its own `used` value, which is not updated by `set-usage`

### Expected Behavior
When a user sets usage via `cpg plan set-usage --id 1 --count 100`:
1. The usage should be recorded as 100
2. New requests should start counting from 100 (i.e., 101, 102, ...)
3. Quota checks should reflect the adjusted usage (e.g., if limit is 1000, remaining should be 900)

### Actual Behavior
There are **two separate tracking systems** that are not synchronized:

**System 1: QuotaManager** (`quota-state.json`)
- Stores `used` value per plan
- Used by `hasRemainingQuota()` for routing decisions
- Updated by `consumeQuota()` and `refundQuota()` during request processing

**System 2: PlanUsageTracker** (`plan-usage-data.json`)
- Stores daily request counts per plan
- Used by `usage-report` command to show usage
- Updated by `adjustUsage()` via `set-usage` command

**Problem A: Adjusted value accumulates with new requests**
- `adjustUsage()` adds the delta to **today's record**
- `incrementDailyUsage()` also increments **today's record**
- Result: `getTotalUsage()` returns `adjusted_value + new_requests`, not the expected value

**Problem B: QuotaManager is not updated**
- `set-usage` only calls `planUsageTracker.adjustUsage()`
- `QuotaManager.used` remains unchanged
- Routing decisions use stale quota data

### Root Cause
1. **`adjustUsage` implementation** - Located in `src/services/plan-usage-tracker.ts:330-382`:
   ```typescript
   adjustUsage(planId, newValue, ...) {
     const oldValue = this.getTotalUsage(planId);
     const delta = newValue - oldValue;
     const todayRecord = this.getOrCreateRecord(planId);
     todayRecord.requestCount = Math.max(0, todayRecord.requestCount + delta);  // Adds delta to today
   }
   ```
   The delta is added to today's record, which is also where `incrementDailyUsage` writes.

2. **No sync with QuotaManager** - Located in `src/cli/commands/plan.ts:213-216`:
   ```typescript
   const result = tracker.adjustUsage(planIdNum, newValue, plan.quota.limit, adjustmentType, adjustmentValue);
   await tracker.persist();
   ```
   Only updates `PlanUsageTracker`, does not update `QuotaManager.used`.

3. **Two independent data sources** - Both systems track usage independently:
   - `QuotaManager.hasRemainingQuota()` uses `quotaStates.get(planId).used`
   - `PlanUsageTracker.getTotalUsage()` sums all daily records
   - Neither queries the other for the "source of truth"

### Minimal Reproduction

1. Start the server:
   ```bash
   npm run start
   ```

2. Make 5 requests to consume quota (this updates both systems to 5)

3. Set usage to 100 via CLI (server still running):
   ```bash
   cpg plan set-usage --id 1 --count 100
   ```

4. Check usage report:
   ```bash
   cpg usage-report --plan 1
   # Shows: Used: 100 (from PlanUsageTracker)
   ```

5. Make 1 more request through the server

6. Check usage report again:
   ```bash
   cpg usage-report --plan 1
   # Shows: Used: 101 (100 + 1 from new request on same day)
   # Expected: 101 (100 set + 1 new request) ✓ Actually correct for this case
   ```

7. **The real problem - quota routing still uses old value**:
   - If `limit = 100` and usage was 5 before `set-usage`
   - After `set-usage --count 100`, `QuotaManager.used` is still 5
   - Server will still route requests to this plan thinking it has 95 remaining
   - But `usage-report` shows 100+ used

8. **Another problem - repeated set-usage on same day**:
   ```bash
   cpg plan set-usage --id 1 --count 100  # Today's record = 100
   cpg plan set-usage --id 1 --count 150  # oldValue=100, delta=50, today's record = 100+50 = 150 ✓
   # But if server made 10 requests between step 1 and 2:
   # oldValue = 110, delta = 40, today's record = 110+40 = 150
   # Result: correct, but request tracking lost
   ```

### Related Code
- `src/services/quota-manager.ts:198-231` - `consumeQuota()` updates both systems
- `src/services/plan-usage-tracker.ts:330-382` - `adjustUsage()` only updates own records
- `src/cli/commands/plan.ts:114-229` - `set-usage` handler does not sync with QuotaManager
- `src/index.ts:38-62` - Both systems initialized independently

### Suggested Fix
Option A: **Single source of truth** - Use `QuotaManager.used` as the authoritative value:
1. `PlanUsageTracker.getUsageReport()` should query `QuotaManager.getQuotaState()` for current usage
2. Daily tracking remains for historical breakdown only

Option B: **Sync on adjustment** - Update both systems when using `set-usage`:
1. Add a method to update `QuotaManager.used` directly
2. Call it from `adjustUsage()` or `set-usage` handler
3. Requires service to be running (or CLI to connect)

Option C: **Persist to same file** - Merge both tracking systems:
1. Use `plan-usage-data.json` as the single data source
2. `QuotaManager` loads initial `used` from `PlanUsageTracker.getTotalUsage()`
3. Remove `quota-state.json`

### Impact
- Medium severity - data inconsistency between systems
- Affects quota routing decisions after manual adjustments
- Can lead to over/under utilization of plans
- `usage-report` shows one value, actual routing uses another
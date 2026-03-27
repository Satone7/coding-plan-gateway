# Research: Fix Usage Tracking Issues

**Feature**: 011-fix-usage-tracking
**Date**: 2026-03-26

## R1: Single Source of Truth Strategy

### Decision
Use `PlanUsageTracker` as the single authoritative source for usage data. `QuotaManager` will query `PlanUsageTracker` for current usage instead of maintaining its own `used` counter.

### Rationale
- `PlanUsageTracker` already has complete historical data (daily records)
- Eliminates data drift between two systems
- Simpler mental model: one place to read/write usage
- Maintains fast lookups via in-memory Map

### Alternatives Considered
1. **Keep dual systems with sync** - Rejected: Adds complexity, still risk of drift
2. **Use QuotaManager as source** - Rejected: Would lose historical daily breakdown data
3. **Create new unified service** - Rejected: Unnecessary abstraction, can extend existing

### Architecture Alignment
- Aligns with ADR-003 (In-Memory Quota Tracking with Persistence)
- Maintains O(1) lookup performance
- File-based persistence continues

---

## R2: expiresOn Reset Date Calculation

### Decision
Reuse existing `calculateEffectiveExpiration` utility from `src/utils/expiration.ts` for reset date calculations in `PlanUsageTracker`.

### Rationale
- Function already correctly handles `expiresOn` (day of month 1-31)
- Handles month boundaries (e.g., February 30th → last day of month)
- Returns `null` for no expiration case
- Well-tested existing code

### Implementation
1. Extend `PlanInfo` interface to include `expiresOn` and `expiresAt`
2. Modify `calculateResetAt` to call `calculateEffectiveExpiration` when `expiresOn` is present
3. Fall back to 1st of next month for monthly period without `expiresOn`

### Alternatives Considered
1. **Duplicate logic** - Rejected: DRY violation, maintenance burden
2. **Rewrite in PlanUsageTracker** - Rejected: Unnecessary, existing utility is sufficient

---

## R3: Timezone Handling for Expiration

### Decision
Use server's local timezone for expiration resets (per clarification session).

### Rationale
- Matches user's local calendar expectations
- Existing code uses local timezone methods in places
- Simpler than UTC for single-user local deployment

### Implementation
- Use local date methods (`getDate()`, `setDate()`) instead of UTC methods
- Midnight = `new Date(year, month, day, 0, 0, 0, 0)` in local time

### Migration Note
Current `calculateEffectiveExpiration` uses UTC methods. Need to add timezone parameter or create local timezone variant.

---

## R4: File Locking for Concurrent Access

### Decision
Implement file locking using `proper-lockfile` package to prevent concurrent write conflicts between CLI and server.

### Rationale
- CLI and server may both access `plan-usage-data.json`
- Existing atomic write (temp file + rename) doesn't prevent read-write races
- `proper-lockfile` is mature, cross-platform, and Node.js native
- Lock retries handle brief contention gracefully

### Implementation
```typescript
import lockfile from 'proper-lockfile';

// In persist method
const release = await lockfile.lock(this.planUsageDataPath);
try {
  await this.writeData();
} finally {
  await release();
}
```

### Alternatives Considered
1. **No locking** - Rejected: Risk of data corruption on concurrent writes
2. **PID file check** - Rejected: Race conditions, not cross-platform
3. **SQLite** - Rejected: Overkill, violates file-based architecture (ADR-002)

---

## R5: QuotaManager Integration

### Decision
Add method `setUsedQuota(planId, value)` to `QuotaManager` that updates the internal state. Called by `set-usage` command via admin API reload endpoint.

### Rationale
- Server running state needs immediate update
- CLI can call reload endpoint if server is running
- Direct file update if server not running (server loads on restart)

### Implementation Flow
```
CLI set-usage:
1. Update PlanUsageTracker (direct file write)
2. If server running: call /api/admin/quota/:planId/sync endpoint
3. Server reloads PlanUsageTracker and updates QuotaManager state
```

### Alternatives Considered
1. **Shared memory** - Rejected: Complex, not needed for single-user
2. **Message queue** - Rejected: Overkill for local deployment
3. **Always restart server** - Rejected: Poor UX

---

## R6: Daily Record Adjustment Strategy

### Decision
Add/subtract the delta to/from today's daily record (per clarification session). This is the current behavior in `adjustUsage()`.

### Rationale
- Preserves historical daily breakdown functionality
- Adjustments appear in daily reports on the day they were made
- Simple implementation with no new record types
- Adjustment history already tracked in `usage-adjustment-history.json`

### Edge Case Handling
- If adjustment creates negative daily count, clamp to 0
- Log warning if clamping occurs
- Historical adjustments remain in adjustment history for audit
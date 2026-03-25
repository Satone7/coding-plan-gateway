# Research: Plan Usage Statistics Enhancement

**Feature**: 008-plan-usage-stats
**Date**: 2026-03-25

## Research Summary

This document captures research findings for implementing plan usage statistics enhancement. The feature extends existing patterns established in the codebase.

---

## Decision 1: Daily Usage Tracking Pattern

**Question**: How should daily usage records be structured and stored?

**Decision**: Follow the existing `UsageTracker` pattern with date-keyed storage.

**Rationale**:
- `UsageTracker` already implements daily usage tracking for API keys
- Same pattern: `{date: {planId: record}}` structure
- Proven reliability with existing implementation
- Consistent code style reduces cognitive load

**Alternatives Considered**:
1. Array of daily records - Rejected: Slower lookups, more complex filtering
2. Per-plan separate files - Rejected: More file I/O, harder to query across plans
3. Database - Rejected: Overkill for single-user local deployment

**Architecture Alignment**: Follows ADR-002 (File-Based Configuration Storage) and ADR-003 (In-Memory Quota Tracking with Persistence) from architecture.md.

---

## Decision 2: Usage Adjustment Flow

**Question**: How should manual usage adjustments be processed?

**Decision**: Create adjustment record, update daily record, persist both atomically.

**Flow**:
1. Validate adjustment request (non-negative, plan exists)
2. Calculate new usage value (count or percent)
3. Record adjustment history entry
4. Update today's daily record
5. Update QuotaManager state
6. Persist all changes

**Rationale**:
- Atomic operation ensures consistency
- History provides audit trail
- Daily record stays consistent with totals

**Alternatives Considered**:
1. Direct QuotaManager update only - Rejected: Loses history, breaks daily consistency
2. Separate adjustment records only - Rejected: Complicates report generation

---

## Decision 3: CLI Command Organization

**Question**: How to organize new plan commands with existing CLI structure?

**Decision**: Add `plan` subcommand namespace, extend `usage-report` with `--plan` flag.

**Commands**:
```
cpg usage-report                    # Existing: API key usage (unchanged)
cpg usage-report --plan <id>        # New: Plan usage report
cpg plan list                       # New: List plans with usage summary
cpg plan set-usage --id <id> ...    # New: Adjust usage
```

**Rationale**:
- Backward compatible (existing commands unchanged)
- Follows existing `cpg key` pattern
- Logical grouping under `plan` namespace

**Alternatives Considered**:
1. `cpg usage-report --type plan` - Rejected: Less intuitive than `--plan`
2. Separate `cpg plan-usage` command - Rejected: Fragmented UX

---

## Decision 4: 90-Day Retention Implementation

**Question**: How to implement automatic cleanup of old daily records?

**Decision**: Add cleanup check during initialization and periodic sync.

**Implementation**:
1. On service initialization, scan for records older than 90 days
2. Delete expired records before loading
3. Include cleanup in periodic sync (runs every syncIntervalMs)

**Rationale**:
- Simple implementation
- Prevents unbounded growth
- Aligns with SC-001 performance target

**Alternatives Considered**:
1. Scheduled cleanup job - Rejected: Overkill for single-user local deployment
2. Cleanup on every write - Rejected: Performance impact
3. Manual cleanup command - Rejected: Requires user intervention

---

## Decision 5: Fix Existing `cpg usage-report` Command

**Question**: What is causing the formatting issue in the existing command?

**Investigation Findings**:

Looking at `src/cli/output/table.ts:176-181`:
```typescript
lines.push(`  ${keyIdShort}                                ${name} ${requests}   ${tokens}`);
```

The table formatting has misaligned columns due to hardcoded spacing that doesn't account for actual content width.

**Decision**: Fix table formatting to use proper padding and alignment.

**Fix Pattern**:
```typescript
// Use padStart/padEnd for consistent column widths
const col1 = keyIdShort.padEnd(12);
const col2 = name.padEnd(20);
const col3 = requests.padStart(8);
const col4 = tokens.padStart(10);
lines.push(`  ${col1}  ${col2} ${col3}   ${col4}`);
```

**Rationale**:
- Fixes immediate bug
- Makes table output readable
- Consistent with other table formatters in codebase

---

## Decision 6: Integration with Existing QuotaManager

**Question**: How does PlanUsageTracker integrate with QuotaManager?

**Decision**: QuotaManager calls PlanUsageTracker for daily record updates.

**Integration Points**:
1. `QuotaManager.consumeQuota()` → also calls `PlanUsageTracker.incrementDailyUsage()`
2. `QuotaManager.refundQuota()` → also calls `PlanUsageTracker.decrementDailyUsage()`
3. `QuotaManager.resetQuota()` → also calls `PlanUsageTracker.resetDailyUsage()`

**Rationale**:
- Single source of truth for usage tracking
- QuotaManager remains the primary interface for usage operations
- PlanUsageTracker provides the time-series breakdown

**Alternatives Considered**:
1. Completely separate services - Rejected: Risk of divergence between current usage and daily records
2. Replace QuotaManager - Rejected: Major refactoring, high risk

---

## Summary

| Decision | Choice | Architecture Alignment |
|----------|--------|------------------------|
| Daily tracking pattern | Date-keyed storage | ADR-002, ADR-003 |
| Adjustment flow | Record + update daily | Consistency principle |
| CLI organization | `--plan` flag + `plan` subcommand | Backward compatible |
| 90-day retention | Init + periodic cleanup | Performance targets |
| Report fix | Proper column padding | UX principle |
| QuotaManager integration | Call PlanUsageTracker | Single source of truth |
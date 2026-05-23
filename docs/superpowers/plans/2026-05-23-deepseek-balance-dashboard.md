# DeepSeek Balance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show DeepSeek account balance in the dashboard instead of local quota percentage for DeepSeek-backed plans.

**Architecture:** Add a DeepSeek usage adapter that reads the official `/user/balance` API and publishes provider usage snapshots with balance metadata. Extend dashboard provider-usage types so plans can render either percentage windows or a provider-supplied summary string, while preserving existing behavior for percentage-based providers.

**Tech Stack:** TypeScript, Vitest, Ink dashboard, existing provider usage adapter framework

---

### Task 1: Add failing tests for DeepSeek balance usage data

**Files:**
- Create: `tests/unit/services/usage-adapters/deepseek-adapter.test.ts`
- Modify: `tests/unit/config/builtin-providers.test.ts`

- [ ] **Step 1: Write the failing adapter and preset tests**

```ts
it('should parse DeepSeek balance info into a provider summary', async () => {
  expect(result.summary?.value).toBe('¥12.34');
});

it('should mark deepseek as usage-api capable', () => {
  expect(getBuiltinProvider('deepseek')!.hasUsageApi).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/services/usage-adapters/deepseek-adapter.test.ts tests/unit/config/builtin-providers.test.ts`
Expected: FAIL because the adapter does not exist and DeepSeek is not marked with `hasUsageApi`.

- [ ] **Step 3: Write minimal implementation**

```ts
export class DeepseekUsageAdapter implements UsageAdapter {
  readonly providerId = 'deepseek';
  readonly cacheTTL = 300;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/services/usage-adapters/deepseek-adapter.test.ts tests/unit/config/builtin-providers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/services/usage-adapters/deepseek-adapter.test.ts tests/unit/config/builtin-providers.test.ts src/services/usage-adapters/deepseek-adapter.ts src/config/builtin-providers.ts
git commit -m "feat: add deepseek balance adapter"
```

### Task 2: Add failing tests for dashboard balance rendering data

**Files:**
- Create: `tests/unit/dashboard/quota-display.test.ts`
- Modify: `tests/unit/utils/dashboard-metrics.test.ts`

- [ ] **Step 1: Write the failing tests for provider summary handling**

```ts
it('should prefer provider summary over percentage windows', () => {
  expect(getQuotaDisplay(snapshot, undefined)).toEqual({
    kind: 'summary',
    text: '¥12.34',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/dashboard/quota-display.test.ts tests/unit/utils/dashboard-metrics.test.ts`
Expected: FAIL because provider summaries are not modeled or rendered yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ProviderUsageSummary {
  mode: 'balance';
  value: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/dashboard/quota-display.test.ts tests/unit/utils/dashboard-metrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dashboard/quota-display.test.ts tests/unit/utils/dashboard-metrics.test.ts src/dashboard/quota-display.ts src/utils/dashboard-metrics.ts src/dashboard/hooks/useDashboardState.ts
git commit -m "feat: model dashboard provider balance summaries"
```

### Task 3: Wire the dashboard and server refresh path

**Files:**
- Modify: `src/index.ts`
- Modify: `src/dashboard/views/PlansView.tsx`
- Modify: `src/dashboard/views/HomeView.tsx`
- Modify: `src/types/usage-adapter.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write the failing integration-facing test**

```ts
it('should include provider summary text in dashboard state', () => {
  expect(snapshot.providerUsage.Deepseek.summary?.value).toBe('¥12.34');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/dashboard/quota-display.test.ts tests/unit/utils/dashboard-metrics.test.ts`
Expected: FAIL until the refresh path and view helpers consume the new summary field.

- [ ] **Step 3: Write minimal implementation**

```ts
dashboardMetrics.setProviderUsage(plan.name, {
  windows: mappedWindows,
  summary: result.summary,
  lastUpdated: new Date().toISOString(),
}, plan.provider);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/services/usage-adapters/deepseek-adapter.test.ts tests/unit/config/builtin-providers.test.ts tests/unit/dashboard/quota-display.test.ts tests/unit/utils/dashboard-metrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/dashboard/views/PlansView.tsx src/dashboard/views/HomeView.tsx src/types/usage-adapter.ts src/types/index.ts
git commit -m "feat: show deepseek balance in dashboard"
```

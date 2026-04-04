# Fix Reload Endpoint Path Mismatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the URL path mismatch in `GatewayNotifier.notifyReload()` so CLI reload notifications reach the correct gateway endpoint.

**Architecture:** Single-line source fix in `gateway-notifier.ts` changing `/internal/reload` to `/api/internal/reload`, plus one unit test update to match the new expected URL. The route registration in `app.ts` (prefix `/api/internal`) and auth exemption in `defaults.ts` (`/api/internal/*`) are already correct.

**Tech Stack:** TypeScript 5.x, Vitest, Fastify 4.x

---

### Task 1: Fix the hardcoded reload path

**Files:**
- Modify: `src/services/gateway-notifier.ts:140`
- Test: `tests/unit/services/gateway-notifier.test.ts:62`

- [ ] **Step 1: Update the unit test expected URL**

In `tests/unit/services/gateway-notifier.test.ts`, line 62, change:

```typescript
        'http://test:8080/internal/reload',
```

to:

```typescript
        'http://test:8080/api/internal/reload',
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/gateway-notifier.test.ts`
Expected: FAIL — test expects `/api/internal/reload` but source produces `/internal/reload`

- [ ] **Step 3: Fix the source path**

In `src/services/gateway-notifier.ts`, line 140, change:

```typescript
    const url = `${this.gatewayUrl}/internal/reload`;
```

to:

```typescript
    const url = `${this.gatewayUrl}/api/internal/reload`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/gateway-notifier.test.ts`
Expected: PASS

- [ ] **Step 5: Run full unit test suite**

Run: `npx vitest run tests/unit/`
Expected: All tests PASS

- [ ] **Step 6: Run integration tests**

Run: `npx vitest run tests/integration/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/gateway-notifier.ts tests/unit/services/gateway-notifier.test.ts
git commit -m "fix: correct reload endpoint path in GatewayNotifier

GatewayNotifier.notifyReload() used /internal/reload but the route
is registered at /api/internal/reload (via Fastify prefix in app.ts).
This caused CLI reload notifications to fail, leaving newly created
API keys unavailable until gateway restart.

Fixes #26"
```

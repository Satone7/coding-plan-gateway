# Quickstart: Fix Task Completion Issues

**Feature**: 002-fix-task-completion-issues
**Date**: 2026-03-23

## Implementation Order

Implement in priority order (P1 → P3) to deliver value incrementally.

---

## 1. Graceful Shutdown (P1)

**Goal**: Persist quota state on application exit

### Files to Modify

- `src/app.ts` - Add onClose hook
- `src/index.ts` - Pass quota manager to app

### Implementation Steps

1. **Modify `createApp` signature** to accept quota manager:

```typescript
// src/app.ts
export interface AppOptions extends Partial<FastifyServerOptions> {
  port?: number;
  host?: string;
  logLevel?: string;
  quotaManager?: QuotaManager;  // Add this
}
```

2. **Register onClose hook** in `createApp`:

```typescript
// src/app.ts - after route registration
if (options.quotaManager) {
  app.addHook('onClose', async () => {
    await options.quotaManager!.shutdown();
  });
}
```

3. **Update `src/index.ts`** to create and pass quota manager:

```typescript
// Create quota manager before app
const quotaManager = createQuotaManager({
  quotaStatePath: process.env.QUOTA_STATE_PATH,
});
await quotaManager.initialize(config.plans);
quotaManager.startPeriodicSync();

// Pass to app
const app = await createApp({
  quotaManager,
  // ... other options
});
```

### Verification

```bash
# Start server, make a request, then Ctrl+C
npm run dev
# Check quota-state.json was updated
cat quota-state.json
```

---

## 2. Configuration Validation Script (P2)

**Goal**: Add `npm run config:validate` command

### Files to Create

- `scripts/validate-config.ts` - CLI script

### Implementation

```typescript
// scripts/validate-config.ts
import { loadConfig } from '../src/config';
import { logger } from '../src/utils/logger';

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? process.env.CONFIG_PATH ?? './config.yaml';

  try {
    await loadConfig(configPath);
    console.log(`✓ Configuration valid: ${configPath}`);
    process.exit(0);
  } catch (error) {
    console.error(`✗ Configuration invalid: ${configPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
```

### Add to package.json

```json
{
  "scripts": {
    "config:validate": "ts-node scripts/validate-config.ts"
  }
}
```

### Verification

```bash
npm run config:validate
# Should exit 0 for valid config, 1 for invalid
```

---

## 3. Configuration Reload Script (P2)

**Goal**: Add `npm run reload` command

### Implementation

Add HTTP endpoint for reload (simpler than signal handling):

```typescript
// src/routes/admin/index.ts - add reload endpoint
fastify.post('/api/reload', async (request, reply) => {
  try {
    const config = await loadConfig(configPath, encryptionKey);
    // Update internal state
    await updatePlans(config.plans);
    return { success: true, planCount: config.plans.length };
  } catch (error) {
    reply.code(500);
    return { success: false, error: String(error) };
  }
});
```

Add npm script:

```json
{
  "scripts": {
    "reload": "curl -X POST http://localhost:8080/api/reload"
  }
}
```

---

## 4. Test Coverage Improvements (P2)

**Goal**: Achieve 80% coverage

### Priority Files

1. **`tests/unit/routes/health.test.ts`** (0% → 80%)
   - Test liveness endpoint
   - Test readiness endpoint
   - Test streaming responses

2. **`tests/unit/utils/validators.test.ts`** (0% → 80%)
   - Test all validation functions
   - Test edge cases and error paths

3. **Expand existing tests** for:
   - `request-proxy.test.ts` - Add streaming error tests
   - Handler tests - Add error branch tests

### Test Template

```typescript
describe('HealthEndpoint', () => {
  it('should return 200 for liveness', async () => {
    // Arrange
    const app = await createApp();

    // Act
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    // Assert
    expect(response.statusCode).toBe(200);
  });
});
```

---

## 5. Lint Warning Fixes (P3)

**Goal**: Zero lint warnings

### Fix Pattern for max-lines-per-function

Extract helper functions:

```typescript
// Before: 139-line function
async createMessage(request: FastifyRequest, reply: FastifyReply) {
  // ... 139 lines
}

// After: Extract helpers
async createMessage(request: FastifyRequest, reply: FastifyReply) {
  const validatedRequest = this.validateRequest(request);
  const selectedPlan = await this.selectPlan(validatedRequest.model);
  return this.streamResponse(validatedRequest, selectedPlan, reply);
}

private validateRequest(request) { /* extracted */ }
private async selectPlan(model) { /* extracted */ }
private async streamResponse(request, plan, reply) { /* extracted */ }
```

### Fix Pattern for max-depth

Use early returns:

```typescript
// Before: 4 levels deep
if (condition1) {
  if (condition2) {
    if (condition3) {
      if (condition4) {
        doSomething();
      }
    }
  }
}

// After: Early returns
if (!condition1) return;
if (!condition2) return;
if (!condition3) return;
if (!condition4) return;
doSomething();
```

### Fix Pattern for max-params

Use options object:

```typescript
// Before: 8 parameters
makeStreamingRequest(
  url, method, headers, body, timeout, signal, onChunk, onError
)

// After: Options object
interface StreamingRequestOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  onChunk: (chunk: Buffer) => void;
  onError: (error: Error) => void;
}

makeStreamingRequest(options: StreamingRequestOptions)
```

### Fix Pattern for unused vars in tests

Remove or prefix with underscore:

```typescript
// Before
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// After (remove unused)
import { describe, it, expect, beforeEach } from 'vitest';

// Or prefix if intentionally unused
import { describe, it, expect, _vi, beforeEach } from 'vitest';
```

---

## Verification Checklist

- [ ] `npm run lint` shows 0 warnings
- [ ] `npm run test:coverage` shows 80%+ for all metrics
- [ ] `npm run config:validate` exits with correct codes
- [ ] `npm run reload` triggers config reload
- [ ] Stopping server with Ctrl+C persists quota state
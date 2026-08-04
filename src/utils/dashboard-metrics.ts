/**
 * Server-side metrics collector for the dashboard.
 * Listens to log entries and aggregates statistics so the dashboard
 * can receive a historical snapshot on connect.
 */

export interface ProviderUsageSnapshot {
  windows: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
  summary?: {
    mode: 'balance';
    value: string;
  };
  lastUpdated: string;
}

export interface LocalQuotaSnapshot {
  percentage: number;
  resetAt: string | null;
  limit: number;
  used: number;
}

/**
 * A proxy request currently in flight (started but not yet completed).
 * Populated from the `Request started` / `Request authenticated` log pair
 * and removed when the completion (or terminal error) log arrives.
 */
export interface ActiveRequest {
  requestId: string;
  /** API key display name, or 'anonymous' when auth is off/unknown */
  apiKey: string;
  method: string;
  url: string;
  format: 'openai' | 'anthropic' | 'unknown';
  /** ISO timestamp of request start */
  startedAt: string;
  /** Milliseconds since the request started (computed at snapshot time) */
  elapsedMs: number;
}

/**
 * One finished proxy request, newest first in the bounded recent buffer.
 * Replaces the old flow diagram's chain list with a flat table-friendly row.
 */
export interface RecentRequest {
  /** API key display name, or 'anonymous' when auth is off/unknown */
  apiKey: string;
  /** Model name as requested by the client (alias not resolved) */
  model: string;
  /** Canonical model actually served upstream, when different from `model` */
  canonicalModel?: string;
  /** Plan name that served the request, or '—' when none was selected */
  plan: string;
  format: 'openai' | 'anthropic' | 'unknown';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  /** Upstream status code, falling back to the gateway response status */
  status: number;
  /** ISO timestamp of request completion */
  at: string;
}

/**
 * One row of the dashboard's plan balance panel. Only plans with an
 * authoritative remaining-quota signal get a row — see buildPlanQuotaRows.
 */
export interface PlanQuotaRow {
  planName: string;
  providerId?: string;
  kind: 'usage-api' | 'balance' | 'local-quota';
  /** Usage percentage 0-100 for 'usage-api' and 'local-quota' rows */
  percentage?: number;
  windows?: Array<{ type: string; percentage: number; windowLabel: string; nextResetTime?: number }>;
  /** Human-readable balance string for 'balance' kind rows (e.g. '¥12.34') */
  balance?: string;
  /** Remaining/limit pair for 'local-quota' kind rows */
  remaining?: number;
  limit?: number;
  resetAt?: string | null;
  lastUpdated: string;
}

export interface MetricsSnapshot {
  completedRequests: number;
  failedRequests: number;
  /** Proxy requests currently in flight, longest-running first */
  activeRequests: ActiveRequest[];
  /** Recent finished proxy requests (newest first, capped) */
  recentRequests: RecentRequest[];
  planUsages: Record<string, { requests: number; tokens: number }>;
  modelUsages: Record<string, { requests: number; tokens: number }>;
  apiKeyUsages: Record<string, { requests: number; tokens: number }>;
  providerUsage: Record<string, ProviderUsageSnapshot>;
  localQuota: Record<string, LocalQuotaSnapshot>;
  planProviders: Record<string, string>; // planName -> providerId
  recentErrors: Array<{
    timestamp: string;
    level: string;
    message: string;
    error?: { name: string; message: string; code?: string; type?: string };
    context?: Record<string, unknown>;
  }>;
}

// Lightweight log entry shape — only fields we actually read
interface LogLike {
  level: string;
  message: string;
  error?: { name: string; message: string; code?: string; type?: string };
  context?: Record<string, unknown>;
}

interface PendingRequest {
  apiKey?: string;
  method?: string;
  url?: string;
  startedAt?: string;
}

export class DashboardMetrics {
  private completedRequests = 0;
  private failedRequests = 0;
  private recentRequests: RecentRequest[] = [];
  private planUsages: Record<string, { requests: number; tokens: number }> = {};
  private modelUsages: Record<string, { requests: number; tokens: number }> = {};
  private apiKeyUsages: Record<string, { requests: number; tokens: number }> = {};
  private providerUsage: Record<string, ProviderUsageSnapshot> = {};
  private localQuota: Record<string, LocalQuotaSnapshot> = {};
  private planProviders: Record<string, string> = {}; // planName -> providerId
  private recentErrors: MetricsSnapshot['recentErrors'] = [];
  private pendingRequests: Record<string, PendingRequest> = {};

  private static readonly MAX_ERRORS = 20;
  private static readonly MAX_RECENT = 200;
  private static readonly MAX_PENDING = 500;

  /** Map a request URL to the API format it belongs to */
  private detectFormat(url: string | undefined): ActiveRequest['format'] {
    if (!url) {
      return 'unknown';
    }
    if (url.includes('/chat/completions')) {
      return 'openai';
    }
    if (url.includes('/messages') || url.includes('/count_tokens')) {
      return 'anthropic';
    }
    return 'unknown';
  }

  /** Whether a completed request is one of the two proxy endpoints we chart */
  private isProxyCompletion(url: string | undefined): boolean {
    return !!url && (url.includes('/chat/completions') || url.endsWith('/messages'));
  }

  processEntry(log: LogLike): void {
    this.collectError(log);

    const ctx = log.context ?? {};
    const requestId = ctx.requestId as string | undefined;
    if (!requestId) {
      return;
    }

    const msg = log.message;

    if (msg === 'Request started') {
      // Bound the map so a flood of requests whose completion log never
      // arrives (client disconnects mid-stream before the hijacked responder
      // logs) cannot grow memory without limit. Oldest entries are evicted.
      if (Object.keys(this.pendingRequests).length >= DashboardMetrics.MAX_PENDING) {
        this.evictOldestPending();
      }
      this.pendingRequests[requestId] = {
        method: ctx.method as string | undefined,
        url: ctx.url as string | undefined,
        startedAt: new Date().toISOString(),
      };
    } else if (msg === 'Request authenticated') {
      const pending = this.pendingRequests[requestId];
      if (pending) {
        pending.apiKey = ctx.keyName as string | undefined;
      }
    } else if (msg === 'Request completed') {
      this.recordCompletion(requestId, ctx);
      delete this.pendingRequests[requestId];
    } else if (msg === 'Request failed' || msg === 'Request error') {
      this.failedRequests++;
      // Do NOT drop the pending entry here: the completion log fires right
      // after with the final statusCode and provider metrics, so the pending
      // entry's key attribution is still needed for the recent-request row.
    }
  }

  /** Keep the newest MAX_ERRORS error/fatal entries for the errors panel */
  private collectError(log: LogLike): void {
    if (log.level !== 'error' && log.level !== 'fatal') {
      return;
    }
    this.recentErrors.unshift({
      timestamp: new Date().toISOString(),
      level: log.level,
      message: log.message,
      error: log.error ? { ...log.error } : undefined,
      context: log.context,
    });
    if (this.recentErrors.length > DashboardMetrics.MAX_ERRORS) {
      this.recentErrors.length = DashboardMetrics.MAX_ERRORS;
    }
  }

  /** Aggregate a completed request into usage counters and the recent list */
  private recordCompletion(requestId: string, ctx: Record<string, unknown>): void {
    const pending = this.pendingRequests[requestId];
    const statusCode = typeof ctx.statusCode === 'number' ? ctx.statusCode : 0;
    const isFailed = statusCode >= 400;
    const url = pending?.url ?? (ctx.url as string | undefined);

    if (!isFailed) {
      this.completedRequests++;
      this.accumulateUsages(ctx, pending?.apiKey);
    }

    // Record proxy endpoint completions — successful or failed — as rows in
    // the recent-requests table.
    if (this.isProxyCompletion(url)) {
      this.pushRecent({ url, statusCode, ctx, pending });
    }
  }

  /** Unshift one finished request onto the bounded recent buffer (newest first) */
  private pushRecent(
    params: {
      url: string | undefined;
      statusCode: number;
      ctx: Record<string, unknown>;
      pending?: PendingRequest;
    }
  ): void {
    const { url, statusCode, ctx, pending } = params;
    const provider = ctx.provider as
      | { planName?: string; model?: string; canonicalModel?: string; statusCode?: number }
      | undefined;
    const tokens = ctx.tokens as { input?: number; output?: number; total?: number } | undefined;
    const upstreamStatus = provider?.statusCode;
    // The completion log strips the method/url (only the error log carries
    // them), so recover the request line from the pending entry or ctx.
    const reqUrl = url ?? (ctx.url as string | undefined);
    this.recentRequests.unshift({
      apiKey: pending?.apiKey ?? (ctx.keyName as string | undefined) ?? 'anonymous',
      model: provider?.model ?? 'unknown',
      canonicalModel: provider?.canonicalModel,
      plan: provider?.planName ?? '—',
      format: this.detectFormat(reqUrl),
      inputTokens: tokens?.input ?? 0,
      outputTokens: tokens?.output ?? 0,
      totalTokens: tokens?.total ?? 0,
      durationMs: (ctx.durationMs as number | undefined) ?? 0,
      // A 0 from early-attached metrics means "upstream never responded";
      // fall back to the gateway status so the row renders as failed.
      status: upstreamStatus && upstreamStatus > 0 ? upstreamStatus : statusCode,
      at: new Date().toISOString(),
    });
    if (this.recentRequests.length > DashboardMetrics.MAX_RECENT) {
      this.recentRequests.length = DashboardMetrics.MAX_RECENT;
    }
  }

  /** Add a successful request's tokens to the per-plan/model/key counters */
  private accumulateUsages(ctx: Record<string, unknown>, apiKey?: string): void {
    const tokens = ((ctx.tokens as { total?: number } | undefined)?.total) ?? 0;

    const planName = (ctx.provider as { planName?: string } | undefined)?.planName;
    if (planName) {
      const prev = this.planUsages[planName] ?? { requests: 0, tokens: 0 };
      this.planUsages[planName] = { requests: prev.requests + 1, tokens: prev.tokens + tokens };
    }

    const provider = ctx.provider as { model?: string; canonicalModel?: string } | undefined;
    const model = provider?.model;
    const canonicalModel = provider?.canonicalModel;
    if (model) {
      const isAliasRouted = canonicalModel && canonicalModel !== model;
      const displayModel = isAliasRouted ? `${model}*` : model;
      const prev = this.modelUsages[displayModel] ?? { requests: 0, tokens: 0 };
      this.modelUsages[displayModel] = { requests: prev.requests + 1, tokens: prev.tokens + tokens };
    }

    if (apiKey) {
      const prev = this.apiKeyUsages[apiKey] ?? { requests: 0, tokens: 0 };
      this.apiKeyUsages[apiKey] = { requests: prev.requests + 1, tokens: prev.tokens + tokens };
    }
  }

  /** Drop the oldest pending entry to keep the map within MAX_PENDING */
  private evictOldestPending(): void {
    let oldestId: string | null = null;
    let oldestAt = '';
    for (const [id, p] of Object.entries(this.pendingRequests)) {
      const at = p.startedAt ?? '';
      if (oldestId === null || at < oldestAt) {
        oldestId = id;
        oldestAt = at;
      }
    }
    if (oldestId !== null) {
      delete this.pendingRequests[oldestId];
    }
  }

  /** In-flight proxy requests, longest-running first */
  private buildActiveRequests(): ActiveRequest[] {
    const now = Date.now();
    const active: ActiveRequest[] = [];
    for (const [requestId, p] of Object.entries(this.pendingRequests)) {
      if (!this.isProxyCompletion(p.url)) {
        continue;
      }
      const startedAt = p.startedAt ?? new Date(now).toISOString();
      const startMs = new Date(startedAt).getTime();
      active.push({
        requestId,
        apiKey: p.apiKey ?? 'anonymous',
        method: p.method ?? '—',
        url: p.url ?? '',
        format: this.detectFormat(p.url),
        startedAt,
        elapsedMs: Number.isFinite(startMs) ? Math.max(0, now - startMs) : 0,
      });
    }
    active.sort((a, b) => b.elapsedMs - a.elapsedMs);
    return active;
  }

  getSnapshot(): MetricsSnapshot {
    return {
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
      activeRequests: this.buildActiveRequests(),
      recentRequests: [...this.recentRequests],
      planUsages: { ...this.planUsages },
      modelUsages: { ...this.modelUsages },
      apiKeyUsages: { ...this.apiKeyUsages },
      providerUsage: { ...this.providerUsage },
      localQuota: { ...this.localQuota },
      planProviders: { ...this.planProviders },
      recentErrors: [...this.recentErrors],
    };
  }

  setProviderUsage(
    planName: string,
    data: ProviderUsageSnapshot,
    providerId?: string
  ): void {
    this.providerUsage[planName] = data;
    if (providerId) {
      this.planProviders[planName] = providerId;
    }
  }

  setLocalQuota(
    planName: string,
    data: LocalQuotaSnapshot,
    providerId?: string
  ): void {
    this.localQuota[planName] = data;
    if (providerId) {
      this.planProviders[planName] = providerId;
    }
  }

  /**
   * Build the plan balance rows for the dashboard.
   *
   * Only plans with an authoritative remaining-quota signal produce a row:
   *  - 'balance'    — provider returned an account balance string (DeepSeek);
   *  - 'usage-api'  — provider returned real quota windows (Zhipu, Kimi);
   *  - 'local-quota'— a finite configured local limit whose remaining is exact
   *                   (limit > 0). Plans with no quota API and no finite local
   *                   limit are deliberately omitted — the panel must not guess.
   */
  buildPlanQuotaRows(): PlanQuotaRow[] {
    const rows: PlanQuotaRow[] = [];
    const seen = new Set<string>();

    for (const [planName, usage] of Object.entries(this.providerUsage)) {
      seen.add(planName);
      const providerId = this.planProviders[planName];
      if (usage.summary?.mode === 'balance') {
        rows.push({
          planName,
          providerId,
          kind: 'balance',
          balance: usage.summary.value,
          lastUpdated: usage.lastUpdated,
        });
        continue;
      }
      if (usage.windows.length > 0) {
        rows.push({
          planName,
          providerId,
          kind: 'usage-api',
          percentage: Math.max(...usage.windows.map((w) => w.percentage)),
          windows: usage.windows,
          lastUpdated: usage.lastUpdated,
        });
      }
      // Usage-API plan with no windows and no balance: nothing accurate to
      // show — skip (fetch may have failed; row appears on the next refresh).
    }

    for (const [planName, quota] of Object.entries(this.localQuota)) {
      if (seen.has(planName)) {
        continue;
      }
      // Only a finite configured limit gives an accurate remaining amount.
      if (quota.limit <= 0) {
        continue;
      }
      rows.push({
        planName,
        providerId: this.planProviders[planName],
        kind: 'local-quota',
        remaining: Math.max(0, quota.limit - quota.used),
        limit: quota.limit,
        percentage: quota.percentage,
        resetAt: quota.resetAt,
        lastUpdated: new Date().toISOString(),
      });
    }

    return rows;
  }

  /**
   * Get Usage API reset times for all plans.
   * Finds the latest (farthest) reset time across all windows for each plan.
   * Uses the farthest window because short-term windows (e.g., 5h sliding) roll over
   * frequently and don't represent a real "expiration" constraint. The longest window
   * (e.g., weekly) reflects the actual quota cycle boundary.
   * @param planIdMap - Map of planName to planId for lookup
   * @returns Map of planId to nextResetTime (Unix timestamp in milliseconds)
   */
  getUsageResetTimes(planIdMap: Map<string, number>): Map<number, number> {
    const result = new Map<number, number>();
    for (const [planName, data] of Object.entries(this.providerUsage)) {
      const planId = planIdMap.get(planName);
      if (!planId) {continue;}

      // Find the latest reset time across all windows (longest quota cycle)
      const latestReset = data.windows
        .filter(w => w.nextResetTime !== undefined)
        .reduce((max, w) => {
          const time = w.nextResetTime!;
          return max === null || time > max ? time : max;
        }, null as number | null);

      if (latestReset !== null) {
        result.set(planId, latestReset);
      }
    }
    return result;
  }

  /**
   * Get Usage API quota percentages for all plans.
   * Finds the highest percentage across all windows for each plan.
   * Higher percentage = more consumed quota.
   * @param planIdMap - Map of planName to planId for lookup
   * @returns Map of planId to highest percentage (0-100)
   */
  getUsagePercentages(planIdMap: Map<string, number>): Map<number, number> {
    const result = new Map<number, number>();
    for (const [planName, data] of Object.entries(this.providerUsage)) {
      const planId = planIdMap.get(planName);
      if (!planId) {continue;}

      // Find the highest percentage across all windows
      // Higher percentage = more consumed, lower quota score
      const maxPercentage = data.windows.length > 0
        ? Math.max(...data.windows.map(w => w.percentage))
        : 0;

      result.set(planId, maxPercentage);
    }
    return result;
  }
}

export const dashboardMetrics = new DashboardMetrics();

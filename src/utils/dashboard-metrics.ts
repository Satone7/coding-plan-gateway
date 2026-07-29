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
 * One finished proxy request, keyed by the routing chain it took.
 * Feeds the web dashboard's request → model → plan flow diagram:
 * edge widths are derived from token totals per chain link.
 */
export interface FlowChain {
  /** API key display name, or 'anonymous' when auth is off/unknown */
  apiKey: string;
  /** Model name as requested by the client (alias not resolved) */
  model: string;
  /** Canonical model actually served upstream, when different from `model` */
  canonicalModel?: string;
  /** Plan name that served the request, or '—' when none was selected */
  plan: string;
  /** Whether the request was served via SSE streaming (best-effort, see processEntry) */
  stream: boolean;
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

export interface MetricsSnapshot {
  completedRequests: number;
  failedRequests: number;
  /** Recent request chains (newest first, capped) for the flow diagram */
  flows: FlowChain[];
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
  private flows: FlowChain[] = [];
  private planUsages: Record<string, { requests: number; tokens: number }> = {};
  private modelUsages: Record<string, { requests: number; tokens: number }> = {};
  private apiKeyUsages: Record<string, { requests: number; tokens: number }> = {};
  private providerUsage: Record<string, ProviderUsageSnapshot> = {};
  private localQuota: Record<string, LocalQuotaSnapshot> = {};
  private planProviders: Record<string, string> = {}; // planName -> providerId
  private recentErrors: MetricsSnapshot['recentErrors'] = [];
  private pendingRequests: Record<string, PendingRequest> = {};

  private static readonly MAX_ERRORS = 20;
  private static readonly MAX_FLOWS = 500;

  /** Map a request URL to the API format it belongs to */
  private detectFormat(url: string | undefined): FlowChain['format'] {
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
      // Do NOT push a flow here: the completion log fires right after with the
      // final statusCode and provider metrics, so recording here too would
      // double-count. Keeping the pending entry lets the completion path
      // attribute the failure to its API key and chain.
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

  /** Aggregate a completed request into usage counters and the flow chain */
  private recordCompletion(requestId: string, ctx: Record<string, unknown>): void {
    const pending = this.pendingRequests[requestId];
    const statusCode = typeof ctx.statusCode === 'number' ? ctx.statusCode : 0;
    const isFailed = statusCode >= 400;
    const url = pending?.url ?? (ctx.url as string | undefined);

    if (!isFailed) {
      this.completedRequests++;
      this.accumulateUsages(ctx, pending?.apiKey);
    }

    // Record the flow chain for proxy endpoint completions — successful or
    // failed, both matter for the flow diagram (failures render as red edges).
    if (this.isProxyCompletion(url)) {
      this.pushFlow({ url, statusCode, ctx, pending });
    }
  }

  /** Unshift one flow chain onto the bounded buffer (newest first) */
  private pushFlow(
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
    this.flows.unshift({
      apiKey: pending?.apiKey ?? (ctx.keyName as string | undefined) ?? 'anonymous',
      model: provider?.model ?? 'unknown',
      canonicalModel: provider?.canonicalModel,
      plan: provider?.planName ?? '—',
      // Stream-ness is not currently logged on completion entries, so the
      // flag stays false; the flow diagram does not depend on it for layout.
      stream: false,
      format: this.detectFormat(reqUrl),
      inputTokens: tokens?.input ?? 0,
      outputTokens: tokens?.output ?? 0,
      totalTokens: tokens?.total ?? 0,
      durationMs: (ctx.durationMs as number | undefined) ?? 0,
      // A 0 from early-attached metrics means "upstream never responded";
      // fall back to the gateway status so the edge renders as failed.
      status: upstreamStatus && upstreamStatus > 0 ? upstreamStatus : statusCode,
      at: pending?.startedAt ?? new Date().toISOString(),
    });
    if (this.flows.length > DashboardMetrics.MAX_FLOWS) {
      this.flows.length = DashboardMetrics.MAX_FLOWS;
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

  getSnapshot(): MetricsSnapshot {
    return {
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
      flows: [...this.flows],
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

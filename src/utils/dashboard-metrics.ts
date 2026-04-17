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
  lastUpdated: string;
}

export interface LocalQuotaSnapshot {
  percentage: number;
  resetAt: string | null;
  limit: number;
  used: number;
}

export interface MetricsSnapshot {
  completedRequests: number;
  failedRequests: number;
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
}

export class DashboardMetrics {
  private completedRequests = 0;
  private failedRequests = 0;
  private planUsages: Record<string, { requests: number; tokens: number }> = {};
  private modelUsages: Record<string, { requests: number; tokens: number }> = {};
  private apiKeyUsages: Record<string, { requests: number; tokens: number }> = {};
  private providerUsage: Record<string, ProviderUsageSnapshot> = {};
  private localQuota: Record<string, LocalQuotaSnapshot> = {};
  private planProviders: Record<string, string> = {}; // planName -> providerId
  private recentErrors: MetricsSnapshot['recentErrors'] = [];
  private pendingRequests: Record<string, PendingRequest> = {};

  private static readonly MAX_ERRORS = 20;

  processEntry(log: LogLike): void {
    // Collect errors
    if (log.level === 'error' || log.level === 'fatal') {
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

    const ctx = log.context ?? {};
    const requestId = ctx.requestId as string | undefined;
    if (!requestId) return;

    const msg = log.message;

    if (msg === 'Request started') {
      this.pendingRequests[requestId] = {};
    } else if (msg === 'Request authenticated') {
      const pending = this.pendingRequests[requestId];
      if (pending) {
        pending.apiKey = ctx.keyName as string | undefined;
      }
    } else if (msg === 'Request completed') {
      const isFailed = typeof ctx.statusCode === 'number' && (ctx.statusCode as number) >= 400;

      if (!isFailed) {
        this.completedRequests++;
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

        const apiKey = this.pendingRequests[requestId]?.apiKey;
        if (apiKey) {
          const prev = this.apiKeyUsages[apiKey] ?? { requests: 0, tokens: 0 };
          this.apiKeyUsages[apiKey] = { requests: prev.requests + 1, tokens: prev.tokens + tokens };
        }
      }

      delete this.pendingRequests[requestId];
    } else if (msg === 'Request failed' || msg === 'Request error') {
      this.failedRequests++;
      delete this.pendingRequests[requestId];
    }
  }

  getSnapshot(): MetricsSnapshot {
    return {
      completedRequests: this.completedRequests,
      failedRequests: this.failedRequests,
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
      if (!planId) continue;

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
      if (!planId) continue;

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

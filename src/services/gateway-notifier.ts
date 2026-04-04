/**
 * GatewayNotifier - Notifies the running gateway of storage changes.
 * Used by CLI to ensure the gateway refreshes its in-memory state.
 */

import { logger } from '@/utils/logger';

/**
 * GatewayNotifier configuration.
 */
export interface GatewayNotifierConfig {
  /** Gateway URL for notifications */
  gatewayUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Types of data that can be reloaded.
 */
export type ReloadType = 'api-keys' | 'usage' | 'all';

/**
 * Result of a quota sync operation.
 */
export interface QuotaSyncResult {
  success: boolean;
  planId: number;
  usage?: number;
  error?: string;
}

/**
 * GatewayNotifier - Sends notifications to the running gateway.
 *
 * @example
 * ```typescript
 * const notifier = createGatewayNotifier({ gatewayUrl: 'http://localhost:8080' });
 *
 * // After modifying storage
 * await notifier.notifyReload('api-keys');
 * ```
 */
export class GatewayNotifier {
  private readonly gatewayUrl: string;
  private readonly timeout: number;

  /**
   * Create a new GatewayNotifier.
   *
   * @param config - Configuration options
   */
  constructor(config: GatewayNotifierConfig = {}) {
    this.gatewayUrl = config.gatewayUrl ?? process.env.GATEWAY_URL ?? 'http://localhost:8080';
    this.timeout = config.timeout ?? 5000; // 5 seconds default
  }

  /**
   * Check if the gateway is running.
   *
   * @returns True if gateway is reachable, false otherwise
   */
  async isGatewayRunning(): Promise<boolean> {
    const url = `${this.gatewayUrl}/health`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeout),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sync quota for a specific plan.
   * This tells the gateway to update its QuotaManager with the current usage from PlanUsageTracker.
   *
   * @param planId - The plan ID to sync
   * @returns QuotaSyncResult indicating success or failure
   */
  async syncQuota(planId: number): Promise<QuotaSyncResult> {
    const url = `${this.gatewayUrl}/api/quota/${planId}/sync`;

    try {
      logger.debug('Syncing quota with gateway', { url, planId });

      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = response.statusText;
        logger.warn('Gateway quota sync failed', {
          status: response.status,
          statusText: errorText,
          planId,
        });
        return {
          success: false,
          planId,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const result = await response.json() as { planId: number; usage: number; synced: boolean };
      logger.debug('Gateway quota sync successful', { result });

      return {
        success: result.synced === true,
        planId: result.planId,
        usage: result.usage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to sync quota with gateway', {
        error: errorMessage,
        url,
        planId,
      });
      return {
        success: false,
        planId,
        error: errorMessage,
      };
    }
  }

  /**
   * Notify the gateway to reload its data.
   *
   * @param type - Type of data to reload
   * @returns True if notification was successful, false otherwise
   */
  async notifyReload(type: ReloadType): Promise<boolean> {
    const url = `${this.gatewayUrl}/api/internal/reload`;

    try {
      logger.debug('Notifying gateway to reload', { url, type });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        logger.warn('Gateway reload notification failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return false;
      }

      const result = await response.json() as { success?: boolean; message?: string };
      logger.debug('Gateway reload notification successful', { result });

      return result.success === true;
    } catch (error) {
      if (error instanceof Error) {
        logger.warn('Failed to notify gateway', {
          error: error.message,
          url,
          type,
        });
      }
      return false;
    }
  }

  /**
   * Notify gateway that API keys have changed.
   */
  async notifyApiKeysChanged(): Promise<boolean> {
    return this.notifyReload('api-keys');
  }

  /**
   * Notify gateway that usage data has changed.
   */
  async notifyUsageChanged(): Promise<boolean> {
    return this.notifyReload('usage');
  }

  /**
   * Notify gateway to reload all data.
   */
  async notifyAllChanged(): Promise<boolean> {
    return this.notifyReload('all');
  }

  /**
   * Get the configured gateway URL.
   */
  getGatewayUrl(): string {
    return this.gatewayUrl;
  }
}

/**
 * Create a new GatewayNotifier instance.
 *
 * @param config - Configuration options
 * @returns A new GatewayNotifier instance
 */
export function createGatewayNotifier(config?: GatewayNotifierConfig): GatewayNotifier {
  return new GatewayNotifier(config);
}
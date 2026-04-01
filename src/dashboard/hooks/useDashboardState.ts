import { useState, useEffect } from 'react';
import * as net from 'net';

export interface PlanUsage {
  planName: string;
  requests: number;
  tokens: number;
  errors: number;
}

export interface RequestPhaseDurations {
  gatewayLatency: number;
  providerLatency: number;
  totalLatency: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: {
    requestId?: string;
    durationMs?: number;
    providerResponseTimeMs?: number;
    provider?: {
      planName?: string;
    };
    tokens?: {
      total?: number;
    };
  };
}

export interface DashboardState {
  activeRequests: number;
  completedRequests: number;
  failedRequests: number;
  phaseDurations: RequestPhaseDurations;
  planUsages: Record<string, PlanUsage>;
  recentLogs: LogEntry[];
}

const SOCKET_PATH = process.env.IPC_SOCKET_PATH || '/tmp/coding-plan-gateway.sock';

// eslint-disable-next-line max-lines-per-function
function processLogEntry(log: LogEntry, setState: React.Dispatch<React.SetStateAction<DashboardState>>): void {
  // eslint-disable-next-line max-lines-per-function
  setState((prevState) => {
    const newState = {
      ...prevState,
      phaseDurations: { ...prevState.phaseDurations },
      planUsages: { ...prevState.planUsages },
    };

    // Keep only last 100 logs
    newState.recentLogs = [log, ...prevState.recentLogs].slice(0, 100);

    const message = log.message;
    const context = log.context || {};

    if (message === 'Request started') {
      newState.activeRequests++;
    } else if (message === 'Request completed') {
      // Make sure activeRequests doesn't drop below 0
      newState.activeRequests = Math.max(0, newState.activeRequests - 1);
      newState.completedRequests++;

      // Update Latencies (Moving Average)
      if (typeof context.durationMs === 'number') {
        const total = context.durationMs;
        const provider = context.providerResponseTimeMs || total;
        const gateway = Math.max(0, total - provider);

        const n = newState.completedRequests;
        newState.phaseDurations.totalLatency =
          (newState.phaseDurations.totalLatency * (n - 1) + total) / n;
        newState.phaseDurations.providerLatency =
          (newState.phaseDurations.providerLatency * (n - 1) + provider) / n;
        newState.phaseDurations.gatewayLatency =
          (newState.phaseDurations.gatewayLatency * (n - 1) + gateway) / n;
      }

      // Update Plan Usage
      if (context.provider && context.provider.planName) {
        const planName = context.provider.planName;
        const prevUsage = newState.planUsages[planName] || {
          planName,
          requests: 0,
          tokens: 0,
          errors: 0,
        };

        newState.planUsages[planName] = {
          ...prevUsage,
          requests: prevUsage.requests + 1,
          tokens: prevUsage.tokens + (context.tokens?.total || 0),
        };
      }
    } else if (message === 'Request failed') {
      newState.activeRequests = Math.max(0, newState.activeRequests - 1);
      newState.failedRequests++;

      if (context.provider && context.provider.planName) {
        const planName = context.provider.planName;
        const prevUsage = newState.planUsages[planName] || {
          planName,
          requests: 0,
          tokens: 0,
          errors: 0,
        };

        newState.planUsages[planName] = {
          ...prevUsage,
          errors: prevUsage.errors + 1,
        };
      }
    }

    return newState;
  });
}

// eslint-disable-next-line max-lines-per-function
export function useDashboardState(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    activeRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
    phaseDurations: {
      gatewayLatency: 0,
      providerLatency: 0,
      totalLatency: 0,
    },
    planUsages: {},
    recentLogs: [],
  });

  useEffect(() => {
    let socket: net.Socket;
    let buffer = '';
    let isComponentMounted = true;
    let reconnectTimer: NodeJS.Timeout;

    const connect = (): void => {
      if (!isComponentMounted) {
        return;
      }

      socket = net.createConnection(SOCKET_PATH);

      socket.on('data', (data) => {
        buffer += data.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        lines.forEach((line) => {
          if (!line.trim()) {
            return;
          }
          try {
            const log = JSON.parse(line) as LogEntry;
            processLogEntry(log, setState);
          } catch (e) {
            // Ignore malformed JSON
          }
        });
      });

      socket.on('error', () => {
        // Silent error, will retry on close
      });

      socket.on('close', () => {
        if (isComponentMounted) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      });
    };

    connect();

    return () => {
      isComponentMounted = false;
      clearTimeout(reconnectTimer);
      if (socket) {
        socket.destroy();
      }
    };
  }, []);

  return state;
}

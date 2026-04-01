import { useState, useEffect } from 'react';
import * as net from 'net';

export interface PlanUsage {
  planName: string;
  requests: number;
  tokens: number;
  errors: number;
}

export interface DimensionUsage {
  requests: number;
  tokens: number;
}

export interface ActiveRequest {
  id: string;
  url: string;
  startTime: number;
  apiKey?: string;
  planName?: string;
  score?: number;
  model?: string;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: {
    requestId?: string;
    durationMs?: number;
    providerResponseTimeMs?: number;
    url?: string;
    keyName?: string;
    selectedPlanName?: string;
    totalScore?: number;
    model?: string;
    provider?: {
      planName?: string;
      model?: string;
    };
    tokens?: {
      total?: number;
    };
  };
}

export interface DashboardState {
  activeRequests: Record<string, ActiveRequest>;
  completedRequests: number;
  failedRequests: number;
  planUsages: Record<string, DimensionUsage>;
  modelUsages: Record<string, DimensionUsage>;
  apiKeyUsages: Record<string, DimensionUsage>;
  recentLogs: LogEntry[];
  recentErrors: LogEntry[];
}

const SOCKET_PATH = process.env.IPC_SOCKET_PATH || '/tmp/coding-plan-gateway.sock';

// eslint-disable-next-line max-lines-per-function
function processLogEntry(log: LogEntry, setState: React.Dispatch<React.SetStateAction<DashboardState>>): void {
  // eslint-disable-next-line max-lines-per-function
  setState((prevState) => {
    const newState = {
      ...prevState,
      activeRequests: { ...prevState.activeRequests },
      planUsages: { ...prevState.planUsages },
      modelUsages: { ...prevState.modelUsages },
      apiKeyUsages: { ...prevState.apiKeyUsages },
      recentLogs: [log, ...prevState.recentLogs].slice(0, 100),
      recentErrors: [...prevState.recentErrors],
    };

    if (log.level === 'warn' || log.level === 'error' || log.level === 'fatal') {
      newState.recentErrors = [log, ...prevState.recentErrors].slice(0, 5);
    }

    const message = log.message;
    const context = log.context || {};
    const requestId = context.requestId;

    if (requestId) {
      if (message === 'Request started') {
        newState.activeRequests[requestId] = {
          id: requestId,
          url: context.url || 'Unknown',
          startTime: Date.now(),
        };
      } else if (message === 'Request authenticated') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].apiKey = context.keyName;
        }
      } else if (message === 'Request routed to plan') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].planName = context.selectedPlanName;
          if (context.model) {
            newState.activeRequests[requestId].model = context.model;
          }
        }
      } else if (message === 'Selected plan with multi-factor score') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].score = context.totalScore;
        }
      } else if (message === 'Request completed' || message === 'Request failed') {
        const activeReq = newState.activeRequests[requestId];
        // Remove from active requests
        delete newState.activeRequests[requestId];
        
        if (message === 'Request completed') {
          newState.completedRequests++;
          
          const tokens = context.tokens?.total || 0;
          
          // Update Plan Usage
          if (context.provider && context.provider.planName) {
            const planName = context.provider.planName;
            const prevUsage = newState.planUsages[planName] || { requests: 0, tokens: 0 };
            newState.planUsages[planName] = {
              requests: prevUsage.requests + 1,
              tokens: prevUsage.tokens + tokens,
            };
          }
          
          // Update Model Usage
          if (context.provider && context.provider.model) {
            const model = context.provider.model;
            const prevUsage = newState.modelUsages[model] || { requests: 0, tokens: 0 };
            newState.modelUsages[model] = {
              requests: prevUsage.requests + 1,
              tokens: prevUsage.tokens + tokens,
            };
          }
          
          // Update API Key Usage
          if (activeReq && activeReq.apiKey) {
            const apiKey = activeReq.apiKey;
            const prevUsage = newState.apiKeyUsages[apiKey] || { requests: 0, tokens: 0 };
            newState.apiKeyUsages[apiKey] = {
              requests: prevUsage.requests + 1,
              tokens: prevUsage.tokens + tokens,
            };
          }
        } else {
          newState.failedRequests++;
        }
      }
    }

    return newState;
  });
}

// eslint-disable-next-line max-lines-per-function
export function useDashboardState(): DashboardState {
  const [state, setState] = useState<DashboardState>({
    activeRequests: {},
    completedRequests: 0,
    failedRequests: 0,
    planUsages: {},
    modelUsages: {},
    apiKeyUsages: {},
    recentLogs: [],
    recentErrors: [],
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

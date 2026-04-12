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
  rpm?: number;
  _requestTimestamps?: number[];
}

export interface ActiveRequest {
  id: string;
  url: string;
  startTime: number;
  apiKey?: string;
  planName?: string;
  score?: number;
  model?: string;
  timeout?: number;
  status?: 'active' | 'completed' | 'failed';
  endTime?: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    type?: string;
  };
  context?: {
    requestId?: string;
    durationMs?: number;
    providerResponseTimeMs?: number;
    url?: string;
    keyName?: string;
    selectedPlanName?: string;
    totalScore?: number;
    model?: string;
    statusCode?: number;
    timeout?: number;
    provider?: {
      planName?: string;
      model?: string;
    };
    tokens?: {
      total?: number;
    };
  };
}

export interface ProviderUsageData {
  windows: Array<{
    type: string;
    percentage: number;
    windowLabel: string;
    nextResetTime?: number;
  }>;
  lastUpdated: string;
}

export interface LocalQuotaData {
  percentage: number;
  resetAt: string | null;
  limit: number;
  used: number;
}

export interface DashboardState {
  activeRequests: Record<string, ActiveRequest>;
  completedRequests: number;
  failedRequests: number;
  planUsages: Record<string, DimensionUsage>;
  modelUsages: Record<string, DimensionUsage>;
  apiKeyUsages: Record<string, DimensionUsage>;
  providerUsage: Record<string, ProviderUsageData>;
  localQuota: Record<string, LocalQuotaData>;
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

    if (log.level === 'error' || log.level === 'fatal') {
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
          status: 'active',
        };
      } else if (message === 'Request authenticated') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].apiKey = context.keyName;
        }
      } else if (message === 'Request routed to plan') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].planName = context.selectedPlanName;
          if (context.timeout !== undefined) {
            newState.activeRequests[requestId].timeout = context.timeout;
          }
          if (context.model) {
            newState.activeRequests[requestId].model = context.model;
          }
        }
      } else if (message === 'Selected plan with multi-factor score') {
        if (newState.activeRequests[requestId]) {
          newState.activeRequests[requestId].score = context.totalScore;
        }
      } else if (message === 'Request completed' || message === 'Request failed' || message === 'Request error') {
        const activeReq = newState.activeRequests[requestId];
        
        const isFailed = message === 'Request failed' || message === 'Request error' || (message === 'Request completed' && context.statusCode && context.statusCode >= 400);
        const wasAlreadyFailed = activeReq?.status === 'failed';

        // Update status instead of removing immediately
        if (activeReq) {
          // If we already marked it as failed from a previous 'Request error' log, don't overwrite with 'completed'
          if (activeReq.status !== 'failed' || isFailed) {
            activeReq.status = isFailed ? 'failed' : 'completed';
          }
          activeReq.endTime = Date.now();
        }
        
        if (message === 'Request completed' && !isFailed) {
          newState.completedRequests++;
          
          const tokens = context.tokens?.total || 0;
          
          // Update Plan Usage
          if (context.provider && context.provider.planName) {
            const planName = context.provider.planName;
            const prevUsage = newState.planUsages[planName] || { requests: 0, tokens: 0 };
            const nowTime = Date.now();
            const timestamps = [...(prevUsage._requestTimestamps || []), nowTime].filter(t => nowTime - t <= 60000);
            
            newState.planUsages[planName] = {
              requests: prevUsage.requests + 1,
              tokens: prevUsage.tokens + tokens,
              rpm: timestamps.length,
              _requestTimestamps: timestamps,
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
        } else if (isFailed && !wasAlreadyFailed) {
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
    providerUsage: {},
    localQuota: {},
    recentLogs: [],
    recentErrors: [],
  });

  useEffect(() => {
    const cleanupTimer = setInterval(() => {
      setState(prevState => {
        const now = Date.now();
        let changed = false;
        const newActive = { ...prevState.activeRequests };
        let failedRequestsCount = prevState.failedRequests;

        for (const [id, req] of Object.entries(newActive)) {
          if (req.status === 'completed' && req.endTime && now - req.endTime > 5000) {
            delete newActive[id];
            changed = true;
          } else if (req.status === 'failed' && req.endTime && now - req.endTime > 10000) {
            delete newActive[id];
            changed = true;
          } else if (req.status === 'active') {
            const timeout = req.timeout ? req.timeout * 1000 : 60000;
            if (now - req.startTime > timeout) {
              newActive[id] = {
                ...req,
                status: 'failed',
                endTime: now
              };
              changed = true;
              failedRequestsCount++;
            }
          }
        }

        let planUsagesChanged = false;
        const newPlanUsages = { ...prevState.planUsages };
        for (const [planName, usage] of Object.entries(newPlanUsages)) {
          if (usage._requestTimestamps && usage._requestTimestamps.length > 0) {
            const validTimestamps = usage._requestTimestamps.filter(t => now - t <= 60000);
            if (validTimestamps.length !== usage._requestTimestamps.length) {
              newPlanUsages[planName] = {
                ...usage,
                rpm: validTimestamps.length,
                _requestTimestamps: validTimestamps,
              };
              planUsagesChanged = true;
            }
          }
        }

        if (changed || planUsagesChanged) {
          return { 
            ...prevState, 
            activeRequests: newActive, 
            planUsages: newPlanUsages,
            failedRequests: failedRequestsCount
          };
        }
        return prevState;
      });
    }, 1000);
    return () => clearInterval(cleanupTimer);
  }, []);

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
            const parsed = JSON.parse(line);
            if (parsed.type === 'snapshot') {
              setState(prev => ({
                ...prev,
                completedRequests: parsed.data.completedRequests,
                failedRequests: parsed.data.failedRequests,
                planUsages: { ...prev.planUsages, ...parsed.data.planUsages },
                modelUsages: { ...prev.modelUsages, ...parsed.data.modelUsages },
                apiKeyUsages: { ...prev.apiKeyUsages, ...parsed.data.apiKeyUsages },
                providerUsage: { ...parsed.data.providerUsage },
                localQuota: { ...parsed.data.localQuota },
                recentErrors: parsed.data.recentErrors.slice(0, 5),
              }));
            } else {
              processLogEntry(parsed as LogEntry, setState);
            }
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

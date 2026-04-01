import React, { useState, useEffect } from 'react';
import { render, Box, Text, useStdout, useInput } from 'ink';
import { Table } from './components/Table';
import { useDashboardState } from './hooks/useDashboardState';
import { loadAuthConfig } from '../config/auth-config';
import { createApiKeyManager } from '../services/api-key-manager';
import type { ApiKey } from '../types/api-key';
import { logger } from '../utils/logger';

// Silence logger to prevent disrupting the UI
logger.info = () => {};
logger.debug = () => {};
logger.warn = () => {};
// keep logger.error to see fatal issues if any

const Dashboard = () => {
  const state = useDashboardState();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns, rows: stdout.rows });
  const [now, setNow] = useState(Date.now());
  const [isErrorsExpanded, setIsErrorsExpanded] = useState(false);

  useInput((input, key) => {
    if (input.toLowerCase() === 'e') {
      setIsErrorsExpanded(prev => !prev);
    }
  });

  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns, rows: stdout.rows });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Load API Keys
    const loadKeys = async () => {
      try {
        const config = loadAuthConfig();
        const manager = createApiKeyManager({ apiKeysPath: config.apiKeysPath });
        await manager.initialize();
        setApiKeys(manager.getAllKeys());
      } catch (err) {
        // Ignore errors if file doesn't exist yet
      }
    };
    
    void loadKeys();
    
    // Poll for API key changes every 5 seconds
    const interval = setInterval(() => {
      void loadKeys();
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Format data for Table
  const planUsageData = Object.entries(state.planUsages).map(([planName, usage]) => ({
    Plan: planName,
    Requests: usage.requests,
    Tokens: usage.tokens
  }));

  const modelUsageData = Object.entries(state.modelUsages).map(([modelName, usage]) => ({
    Model: modelName,
    Requests: usage.requests,
    Tokens: usage.tokens
  }));

  const apiKeyUsageData = Object.entries(state.apiKeyUsages).map(([keyName, usage]) => ({
    'API Key': keyName,
    Requests: usage.requests,
    Tokens: usage.tokens
  }));

  const activeRequests = Object.values(state.activeRequests);

  return (
    <Box width={size.columns} height={size.rows} flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="cyan">🚀 CODING PLAN GATEWAY DASHBOARD 🚀</Text>
      </Box>

      {/* Summary Stats */}
      <Box flexDirection="row" marginBottom={1} justifyContent="space-between">
        <Box flexDirection="column" width="100%" borderStyle="single" borderColor="blue" paddingX={1}>
          <Box marginBottom={1}><Text bold color="blue">📊 Summary</Text></Box>
          <Box flexDirection="row" justifyContent="space-between">
            <Text>🟢 Active: <Text color="green">{activeRequests.length}</Text></Text>
            <Text>✅ Completed: <Text color="blue">{state.completedRequests}</Text></Text>
            <Text>❌ Failed: <Text color="red">{state.failedRequests}</Text></Text>
          </Box>
        </Box>
      </Box>

      {/* Active Requests */}
      <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginBottom={1} minHeight={4}>
        <Box marginBottom={1}><Text bold color="yellow">⏳ Active Requests</Text></Box>
        {activeRequests.length > 0 ? (
          activeRequests.map(req => {
            const duration = Math.floor((now - req.startTime) / 1000);
            return (
              <Box key={req.id} flexDirection="row" marginBottom={0}>
                <Box width={6}><Text color="green">{duration}s</Text></Box>
                <Box width={15}><Text color="cyan" wrap="truncate-end">{req.apiKey || 'Auth...'}</Text></Box>
                <Box width={15}><Text color="yellow" wrap="truncate-end">{req.model || 'Unknown'}</Text></Box>
                <Box width={20}><Text color="blue" wrap="truncate-end">{req.planName || 'Routing...'}</Text></Box>
                <Box width={8}><Text color="magenta">{req.score !== undefined ? req.score.toFixed(2) : '-'}</Text></Box>
                <Box flexGrow={1}><Text wrap="truncate-end">{req.url}</Text></Box>
              </Box>
            );
          })
        ) : (
          <Text color="gray">No active requests.</Text>
        )}
      </Box>

      {/* Recent Errors Panel */}
      <Box flexDirection="column" borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} minHeight={3}>
        <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
          <Text bold color="red">🚨 Recent Errors & Warnings</Text>
          <Text color="gray">[Press 'E' to {isErrorsExpanded ? 'collapse' : 'expand'}]</Text>
        </Box>
        {state.recentErrors.length > 0 ? (
          state.recentErrors.map((log, i) => (
            <Box key={i} flexDirection="column" marginBottom={isErrorsExpanded ? 1 : 0}>
              <Text color={log.level === 'warn' ? 'yellow' : 'red'} wrap={isErrorsExpanded ? 'wrap' : 'truncate-end'}>
                [{log.timestamp}] {log.message}
              </Text>
              {isErrorsExpanded && log.context && Object.keys(log.context).length > 0 && (
                <Box paddingLeft={2}>
                  <Text color="gray">{JSON.stringify(log.context, null, 2)}</Text>
                </Box>
              )}
            </Box>
          ))
        ) : (
          <Text color="gray">No recent errors.</Text>
        )}
      </Box>

      {/* Multi-dimensional Stats */}
      <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} marginBottom={1} flexGrow={1}>
        <Box marginBottom={1}><Text bold color="magenta">📈 Usage Statistics</Text></Box>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column" width="32%">
            <Text bold color="blue">By Plan</Text>
            {planUsageData.length > 0 ? (
              <Table data={planUsageData} />
            ) : (
              <Text color="gray">No data</Text>
            )}
          </Box>
          <Box flexDirection="column" width="32%">
            <Text bold color="cyan">By Model</Text>
            {modelUsageData.length > 0 ? (
              <Table data={modelUsageData} />
            ) : (
              <Text color="gray">No data</Text>
            )}
          </Box>
          <Box flexDirection="column" width="32%">
            <Text bold color="green">By API Key</Text>
            {apiKeyUsageData.length > 0 ? (
              <Table data={apiKeyUsageData} />
            ) : (
              <Text color="gray">No data</Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// Clear screen and render
console.clear();
render(<Dashboard />);

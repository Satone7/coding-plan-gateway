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
  const [size, setSize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [now, setNow] = useState(Date.now());
  const [isErrorsExpanded, setIsErrorsExpanded] = useState(false);

  useInput((input, key) => {
    if (input.toLowerCase() === 'e') {
      setIsErrorsExpanded(prev => !prev);
    }
  }, { isActive: Boolean(process.stdin.isTTY) });

  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    if (stdout && typeof stdout.on === 'function') {
      stdout.on('resize', onResize);
      return () => {
        stdout.off('resize', onResize);
      };
    }
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
    <Box width={size.columns} height={size.rows} flexDirection="column">
      {/* Top Header Row */}
      <Box flexDirection="row" justifyContent="space-between" backgroundColor="cyan" paddingX={1}>
        <Text bold color="black">🚀 CODING PLAN GATEWAY</Text>
        <Text color="black">
          🟢 Act: <Text bold>{activeRequests.length}</Text> │ 
          ✅ Ok: <Text bold>{state.completedRequests}</Text> │ 
          ❌ Err: <Text bold>{state.failedRequests}</Text>
        </Text>
      </Box>

      {/* Main Content Split */}
      <Box flexDirection="row" flexGrow={1} width="100%" paddingTop={1}>
        {/* Left Column: Active Requests & Errors */}
        <Box flexDirection="column" width="50%" borderStyle="single" borderRight={true} borderLeft={false} borderTop={false} borderBottom={false} borderColor="gray" paddingRight={1}>
          
          {/* Active Requests */}
          <Box flexDirection="column" marginBottom={1}>
            <Box backgroundColor="blue" paddingX={1} marginBottom={0}>
              <Text bold color="white">⏳ Active Requests</Text>
            </Box>
            <Box flexDirection="column" paddingX={1}>
              {activeRequests.length > 0 ? (
                activeRequests.map(req => {
                  const duration = Math.floor((now - req.startTime) / 1000);
                  return (
                    <Box key={req.id} flexDirection="row">
                      <Box width={5}><Text color="green">{duration}s</Text></Box>
                      <Box width={10}><Text color="cyan" wrap="truncate-end">{req.apiKey || 'Auth...'}</Text></Box>
                      <Box width={12}><Text color="yellow" wrap="truncate-end">{req.model || 'Unknown'}</Text></Box>
                      <Box width={12}><Text color="blue" wrap="truncate-end">{req.planName || 'Routing...'}</Text></Box>
                      <Box width={6}><Text color="magenta">{req.score !== undefined ? req.score.toFixed(1) : '-'}</Text></Box>
                      <Box flexGrow={1}><Text wrap="truncate-end">{req.url}</Text></Box>
                    </Box>
                  );
                })
              ) : (
                <Text color="gray">No active requests.</Text>
              )}
            </Box>
          </Box>

          {/* Recent Errors */}
          <Box flexDirection="column">
            <Box backgroundColor="red" paddingX={1} marginBottom={0} flexDirection="row" justifyContent="space-between">
              <Text bold color="white">🚨 Recent Errors</Text>
              <Text color="white">[E]xpand</Text>
            </Box>
            <Box flexDirection="column" paddingX={1}>
              {state.recentErrors.length > 0 ? (
                state.recentErrors.map((log, i) => (
                  <Box key={i} flexDirection="column" marginBottom={isErrorsExpanded ? 1 : 0}>
                    <Text color={log.level === 'warn' ? 'yellow' : 'red'} wrap={isErrorsExpanded ? 'wrap' : 'truncate-end'}>
                      [{log.timestamp.includes('T') ? (log.timestamp.split('T')[1]?.split('.')[0] || log.timestamp) : log.timestamp}] {log.message}
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
          </Box>
        </Box>

        {/* Right Column: Usage Statistics */}
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          <Box backgroundColor="magenta" paddingX={1} marginBottom={1}>
            <Text bold color="white">📈 Usage Statistics</Text>
          </Box>
          
          <Box flexDirection="column" paddingX={1}>
            <Box marginBottom={1} flexDirection="column">
              <Text bold color="blue" underline>By Plan</Text>
              {planUsageData.length > 0 ? <Table data={planUsageData} /> : <Text color="gray">No data</Text>}
            </Box>
            
            <Box marginBottom={1} flexDirection="column">
              <Text bold color="cyan" underline>By Model</Text>
              {modelUsageData.length > 0 ? <Table data={modelUsageData} /> : <Text color="gray">No data</Text>}
            </Box>
            
            <Box marginBottom={1} flexDirection="column">
              <Text bold color="green" underline>By API Key</Text>
              {apiKeyUsageData.length > 0 ? <Table data={apiKeyUsageData} /> : <Text color="gray">No data</Text>}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// Clear screen and render
console.clear();
render(<Dashboard />);

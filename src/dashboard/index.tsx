import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
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
  const planUsageData = Object.values(state.planUsages).map(usage => ({
    Plan: usage.planName,
    Requests: usage.requests,
    Tokens: usage.tokens,
    Errors: usage.errors
  }));

  const apiKeyData = apiKeys.map(key => ({
    Name: key.name,
    Prefix: key.prefix,
    Status: key.status,
    Created: new Date(key.createdAt).toLocaleDateString(),
    'Last Used': key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'
  }));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="cyan">🚀 CODING PLAN GATEWAY DASHBOARD 🚀</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1} justifyContent="space-between">
        <Box flexDirection="column" width="45%" borderStyle="single" borderColor="yellow" paddingX={1}>
          <Box marginBottom={1}><Text bold color="yellow">📊 Request Status</Text></Box>
          <Text>🟢 Active:    <Text color="green">{state.activeRequests}</Text></Text>
          <Text>✅ Completed: <Text color="blue">{state.completedRequests}</Text></Text>
          <Text>❌ Failed:    <Text color="red">{state.failedRequests}</Text></Text>
        </Box>
        
        <Box flexDirection="column" width="45%" borderStyle="single" borderColor="magenta" paddingX={1}>
          <Box marginBottom={1}><Text bold color="magenta">⏱️  Average Latency</Text></Box>
          <Text>🚪 Gateway:  <Text color="cyan">{state.phaseDurations.gatewayLatency.toFixed(2)}ms</Text></Text>
          <Text>☁️  Provider: <Text color="cyan">{state.phaseDurations.providerLatency.toFixed(2)}ms</Text></Text>
          <Text>⚡ Total:    <Text color="cyan">{state.phaseDurations.totalLatency.toFixed(2)}ms</Text></Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">📈 Plan Usage</Text>
        {planUsageData.length > 0 ? (
          <Box><Table data={planUsageData} /></Box>
        ) : (
          <Box marginY={1}><Text color="gray">No plan usage data available yet.</Text></Box>
        )}
      </Box>

      <Box flexDirection="column">
        <Text bold color="green">🔑 API Keys</Text>
        {apiKeyData.length > 0 ? (
          <Box><Table data={apiKeyData} /></Box>
        ) : (
          <Box marginY={1}><Text color="gray">No API keys configured.</Text></Box>
        )}
      </Box>
    </Box>
  );
};

// Clear screen and render
console.clear();
render(<Dashboard />);

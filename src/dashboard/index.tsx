import React, { useState, useEffect } from 'react';
import { render, Box, Text, useStdout, useInput } from 'ink';
import { useDashboardState } from './hooks/useDashboardState';
import { loadAuthConfig } from '../config/auth-config';
import { createApiKeyManager } from '../services/api-key-manager';
import type { ApiKey } from '../types/api-key';
import { logger } from '../utils/logger';

import { Divider } from './components/Divider';
import { HomeView } from './views/HomeView';
import { PlansView } from './views/PlansView';
import { ModelsView } from './views/ModelsView';
import { KeysView } from './views/KeysView';
import { HealthView } from './views/HealthView';

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
  const [currentView, setCurrentView] = useState<'home' | 'plans' | 'models' | 'keys' | 'health'>('home');

  useInput((input, key) => {
    const char = input.toLowerCase();
    if (char === 'e') {
      setIsErrorsExpanded(prev => !prev);
    } else if (char === '1') {
      setCurrentView('plans');
    } else if (char === '2') {
      setCurrentView('models');
    } else if (char === '3') {
      setCurrentView('keys');
    } else if (char === '4') {
      setCurrentView('health');
    } else if (char === 'h') {
      setCurrentView('home');
    } else if (char === 'q') {
      process.exit(0);
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

  const activeRequests = Object.values(state.activeRequests);

  // Helper for formatting time
  const timeString = new Date(now).toLocaleTimeString();

  return (
    <Box width={size.columns} height={size.rows} flexDirection="column">
      {/* Global Header */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color="cyan">🚀 CODING PLAN GATEWAY DASHBOARD</Text>
        <Text>🕐 {timeString}</Text>
      </Box>
      <Divider width={size.columns} color="cyan" char="═" />
      <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <Text>
          📊 Active: <Text bold color="green">{activeRequests.length}</Text>  ✅ Completed: <Text bold color="blue">{state.completedRequests}</Text>  ❌ Failed: <Text bold color="red">{state.failedRequests}</Text>
        </Text>
        <Text color="gray">[Press 1-4: Plans|Models|Keys|Health]</Text>
      </Box>

      {/* Main View Area */}
      <Box flexGrow={1} flexDirection="column" width="100%">
        {currentView === 'home' && (
          <HomeView state={state} activeRequests={activeRequests} now={now} isErrorsExpanded={isErrorsExpanded} columns={size.columns} />
        )}
        {currentView === 'plans' && <PlansView state={state} columns={size.columns} />}
        {currentView === 'models' && <ModelsView state={state} columns={size.columns} />}
        {currentView === 'keys' && <KeysView state={state} apiKeys={apiKeys} columns={size.columns} />}
        {currentView === 'health' && <HealthView columns={size.columns} />}
      </Box>

      {/* Global Footer */}
      <Divider width={size.columns} color="cyan" char="═" />
      <Box flexDirection="row">
        <Text color="cyan">[1]</Text><Text>Plans  </Text>
        <Text color="cyan">[2]</Text><Text>Models  </Text>
        <Text color="cyan">[3]</Text><Text>API Keys  </Text>
        <Text color="cyan">[4]</Text><Text>Health  </Text>
        <Text color="cyan">[H]</Text><Text>Home  </Text>
        <Text color="cyan">[E]</Text><Text>Errors  </Text>
        <Text color="cyan">[Q]</Text><Text>Quit</Text>
      </Box>
    </Box>
  );
};

// Clear screen and render
console.clear();
render(<Dashboard />);

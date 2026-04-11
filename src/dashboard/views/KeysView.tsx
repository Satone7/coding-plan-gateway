import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor } from '../utils';
import { useTheme } from '../context';
import type { DashboardState } from '../hooks/useDashboardState';
import type { ApiKey } from '../../types/api-key';

interface KeysViewProps {
  state: DashboardState;
  apiKeys: ApiKey[];
  columns: number;
}

export function KeysView({ state, apiKeys, columns }: KeysViewProps) {
  const { theme } = useTheme();
  const keys = Object.entries(state.apiKeyUsages).sort((a, b) => b[1].requests - a[1].requests);

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="🔑 API KEYS USAGE" color={theme.brand} />
      {keys.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {(() => {
            const totalRequests = Math.max(1, Object.values(state.apiKeyUsages).reduce((sum, u) => sum + u.requests, 0));
            return keys.map(([name, usage]) => {
              const percent = Math.min(100, Math.round((usage.requests / totalRequests) * 100));

              return (
                <Box key={name} flexDirection="row" marginBottom={1}>
                  <Box width={25}><Text bold color={theme.brand}>{name}</Text></Box>
                  <Box flexDirection="column">
                    <Box flexDirection="row">
                      <Box width={15}><Text>Requests: </Text></Box>
                      <Box width={12}><Text color={getColor(percent, theme)}>{renderBar(percent, 10)}</Text></Box>
                      <Text>{formatCompactNumber(usage.requests)} req</Text>
                    </Box>
                    <Box flexDirection="row">
                      <Box width={15}><Text>Tokens: </Text></Box>
                      <Text>{formatCompactNumber(usage.tokens)} tok</Text>
                    </Box>
                  </Box>
                </Box>
              );
            });
          })()}
        </Box>
      ) : (
        <Text color={theme.muted}>  No API keys usage found.</Text>
      )}
    </Box>
  );
}

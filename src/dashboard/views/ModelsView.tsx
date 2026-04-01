import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor } from '../utils';
import type { DashboardState } from '../hooks/useDashboardState';

interface ModelsViewProps {
  state: DashboardState;
  columns: number;
}

export function ModelsView({ state, columns }: ModelsViewProps) {
  const models = Object.entries(state.modelUsages).sort((a, b) => b[1].requests - a[1].requests);

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="🤖 MODELS USAGE" color="cyan" />
      {models.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {models.map(([name, usage]) => {
            const percent = Math.min(100, Math.round((usage.requests / 500000) * 100)); 
            
            return (
              <Box key={name} flexDirection="row" marginBottom={1}>
                <Box width={20}><Text bold color="yellow">{name}</Text></Box>
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Box width={15}><Text>Requests: </Text></Box>
                    <Box width={12}><Text color={getColor(percent)}>{renderBar(percent, 10)}</Text></Box>
                    <Text>{formatCompactNumber(usage.requests)} req</Text>
                  </Box>
                  <Box flexDirection="row">
                    <Box width={15}><Text>Tokens: </Text></Box>
                    <Text>{formatCompactNumber(usage.tokens)} tok</Text>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Text color="gray">  No models found.</Text>
      )}
    </Box>
  );
}

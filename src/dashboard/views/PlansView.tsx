import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor } from '../utils';
import type { DashboardState } from '../hooks/useDashboardState';

interface PlansViewProps {
  state: DashboardState;
  columns: number;
}

export function PlansView({ state, columns }: PlansViewProps) {
  const plans = Object.entries(state.planUsages).sort((a, b) => b[1].requests - a[1].requests);

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="📊 PLANS USAGE" color="blue" />
      {plans.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {plans.map(([name, usage]) => {
            // Placeholder metrics for demo
            const quotaPercent = Math.min(100, Math.round((usage.requests / 1000000) * 100)); 
            const tokensPercent = Math.min(100, Math.round((usage.tokens / 5000000) * 100)); 
            
            return (
              <Box key={name} flexDirection="row" marginBottom={1}>
                <Box width={15}><Text bold color="cyan">{name}</Text></Box>
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Box width={15}><Text>Requests: </Text></Box>
                    <Box width={12}><Text color={getColor(quotaPercent)}>{renderBar(quotaPercent, 10)}</Text></Box>
                    <Text>{formatCompactNumber(usage.requests)} req</Text>
                  </Box>
                  <Box flexDirection="row">
                    <Box width={15}><Text>Tokens: </Text></Box>
                    <Box width={12}><Text color={getColor(tokensPercent)}>{renderBar(tokensPercent, 10)}</Text></Box>
                    <Text>{formatCompactNumber(usage.tokens)} tok</Text>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Text color="gray">  No plans found.</Text>
      )}
    </Box>
  );
}

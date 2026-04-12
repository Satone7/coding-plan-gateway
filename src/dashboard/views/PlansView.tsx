import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor, formatResetTime } from '../utils';
import { useTheme } from '../context';
import type { DashboardState } from '../hooks/useDashboardState';

interface PlansViewProps {
  state: DashboardState;
  columns: number;
}

export function PlansView({ state, columns }: PlansViewProps) {
  const { theme } = useTheme();
  const plans = Object.entries(state.planUsages).sort((a, b) => b[1].requests - a[1].requests);

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="📊 PLANS USAGE" color={theme.brand} />
      {plans.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {(() => {
            const totalRequests = Math.max(1, Object.values(state.planUsages).reduce((sum, u) => sum + u.requests, 0));
            const totalTokens = Math.max(1, Object.values(state.planUsages).reduce((sum, u) => sum + u.tokens, 0));

            return plans.map(([name, usage]) => {
              const quotaPercent = Math.min(100, Math.round((usage.requests / totalRequests) * 100));
              const tokensPercent = Math.min(100, Math.round((usage.tokens / totalTokens) * 100));
              const rpm = usage.rpm || 0;
              const rpmPercent = Math.min(100, Math.round((rpm / 20) * 100));
              const providerData = state.providerUsage[name];

              return (
                <Box key={name} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row">
                    <Box width={15}><Text bold color={theme.brand}>{name}</Text></Box>
                    <Box flexDirection="column">
                      <Box flexDirection="row">
                        <Box width={15}><Text>Requests: </Text></Box>
                        <Box width={12}><Text color={getColor(quotaPercent, theme)}>{renderBar(quotaPercent, 10)}</Text></Box>
                        <Text>{formatCompactNumber(usage.requests)} req</Text>
                      </Box>
                      <Box flexDirection="row">
                        <Box width={15}><Text>Tokens: </Text></Box>
                        <Box width={12}><Text color={getColor(tokensPercent, theme)}>{renderBar(tokensPercent, 10)}</Text></Box>
                        <Text>{formatCompactNumber(usage.tokens)} tok</Text>
                      </Box>
                      <Box flexDirection="row">
                        <Box width={15}><Text>RPM: </Text></Box>
                        <Box width={12}><Text color={getColor(rpmPercent, theme)}>{renderBar(rpmPercent, 10)}</Text></Box>
                        <Text color={theme.brand}>{rpm} RPM</Text>
                      </Box>
                    </Box>
                  </Box>
                  {providerData && providerData.windows.length > 0 && (
                    <Box flexDirection="row">
                      <Box width={15}><Text color={theme.muted}>Quota:</Text></Box>
                      <Box flexDirection="row" flexWrap="wrap">
                        {providerData.windows.map((win, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <Text color={theme.muted}> | </Text>}
                            <Text color={theme.muted}>{win.windowLabel} </Text>
                            <Text color={getColor(win.percentage, theme)}>
                              {renderBar(win.percentage, 10)} {win.percentage.toFixed(0)}%
                            </Text>
                            {win.nextResetTime && (
                              <Text color={theme.muted}>/{formatResetTime(win.nextResetTime)}</Text>
                            )}
                          </React.Fragment>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              );
            });
          })()}
        </Box>
      ) : (
        <Text color={theme.muted}>  No plans found.</Text>
      )}
    </Box>
  );
}

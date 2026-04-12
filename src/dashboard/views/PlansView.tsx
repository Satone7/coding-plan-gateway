import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor, formatResetTime, formatResetTimeFromIso, calcBarWithLabelLayout } from '../utils';
import { useTheme } from '../context';
import type { DashboardState } from '../hooks/useDashboardState';
import type { ThemeColors } from '../theme/types';

interface PlansViewProps {
  state: DashboardState;
  columns: number;
}

/** Render a simple bar with filled in progress color, empty in muted/white. */
function renderColorBar(percent: number, length: number, theme: ThemeColors) {
  const filledBlocks = Math.round((percent / 100) * length);
  const clampedFilled = Math.max(0, Math.min(filledBlocks, length));
  const emptyBlocks = length - clampedFilled;
  const progressColor = getColor(percent, theme);
  return (
    <>
      <Text color={progressColor}>{'▓'.repeat(clampedFilled)}</Text>
      <Text color={theme.muted}>{'░'.repeat(emptyBlocks)}</Text>
    </>
  );
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

              // Helper for quota bar with centered label
              const renderQuotaBar = (percent: number, label: 'EXACT' | 'GUESS') => {
                const layout = calcBarWithLabelLayout(percent);
                const progressColor = getColor(percent, theme);
                return (
                  <>
                    <Text color={progressColor}>{'▓'.repeat(layout.before)}</Text>
                    <Text color={theme.muted}>{label}</Text>
                    <Text color={progressColor}>{'▓'.repeat(layout.after)}</Text>
                    <Text color={theme.muted}>{'░'.repeat(layout.empty)}</Text>
                  </>
                );
              };

              return (
                <Box key={name} flexDirection="column" marginBottom={1}>
                  <Box flexDirection="row">
                    <Box width={15}><Text bold color={theme.brand}>{name}</Text></Box>
                    <Box flexDirection="column">
                      <Box flexDirection="row">
                        <Box width={15}><Text>Requests: </Text></Box>
                        <Box width={12}>{renderColorBar(quotaPercent, 10, theme)}</Box>
                        <Text>{formatCompactNumber(usage.requests)} req</Text>
                      </Box>
                      <Box flexDirection="row">
                        <Box width={15}><Text>Tokens: </Text></Box>
                        <Box width={12}>{renderColorBar(tokensPercent, 10, theme)}</Box>
                        <Text>{formatCompactNumber(usage.tokens)} tok</Text>
                      </Box>
                      <Box flexDirection="row">
                        <Box width={15}><Text>RPM: </Text></Box>
                        <Box width={12}>{renderColorBar(rpmPercent, 10, theme)}</Box>
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
                            {renderQuotaBar(win.percentage, 'EXACT')}
                            <Text color={getColor(win.percentage, theme)}> {win.percentage.toFixed(0)}%</Text>
                            {win.nextResetTime && (
                              <Text color={theme.muted}>/{formatResetTime(win.nextResetTime)}</Text>
                            )}
                          </React.Fragment>
                        ))}
                      </Box>
                    </Box>
                  )}
                  {state.localQuota[name] && (
                    <Box flexDirection="row">
                      <Box width={15}><Text color={theme.muted}>Quota:</Text></Box>
                      {renderQuotaBar(state.localQuota[name].percentage, 'GUESS')}
                      <Text color={getColor(state.localQuota[name].percentage, theme)}>
                        {' '}{state.localQuota[name].percentage}%{state.localQuota[name].resetAt ? `/${formatResetTimeFromIso(state.localQuota[name].resetAt)}` : ''}
                      </Text>
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

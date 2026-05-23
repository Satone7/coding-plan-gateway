import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor, formatResetTime, formatResetTimeFromIso, calcBarLayout } from '../utils';
import { useTheme } from '../context';
import type { DashboardState } from '../hooks/useDashboardState';
import type { ThemeColors } from '../theme/types';
import { getQuotaDisplay } from '../quota-display';

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
              const localQuotaData = state.localQuota[name];
              const quotaDisplay = getQuotaDisplay(providerData, localQuotaData);

              // Helper for quota bar with centered label
              const renderQuotaBar = (percent: number, label: 'EXACT' | 'GUESS') => {
                const layout = calcBarLayout(percent, label);
                const progressColor = getColor(percent, theme);
                return (
                  <>
                    {layout.map((item, i) => (
                      <Text key={i} color={item.filled ? progressColor : theme.muted}>{item.char}</Text>
                    ))}
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
                  {quotaDisplay.kind === 'windows' && (
                    <Box flexDirection="row">
                      <Box width={15}><Text color={theme.muted}>Quota:</Text></Box>
                      <Box flexDirection="row" flexWrap="wrap">
                        {quotaDisplay.windows.map((win, i) => (
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
                  {quotaDisplay.kind === 'summary' && (
                    <Box flexDirection="row">
                      <Box width={15}><Text color={theme.muted}>Balance:</Text></Box>
                      <Text color={theme.success}>{quotaDisplay.text}</Text>
                    </Box>
                  )}
                  {quotaDisplay.kind === 'local' && (
                    <Box flexDirection="row">
                      <Box width={15}><Text color={theme.muted}>Quota:</Text></Box>
                      {renderQuotaBar(quotaDisplay.percentage, 'GUESS')}
                      <Text color={getColor(quotaDisplay.percentage, theme)}>
                        {' '}{quotaDisplay.percentage}%{quotaDisplay.resetAt ? `/${formatResetTimeFromIso(quotaDisplay.resetAt)}` : ''}
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

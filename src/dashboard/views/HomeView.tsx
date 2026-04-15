import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, getColor, renderBar, calcBarLayout, formatResetTime, formatResetTimeFromIso } from '../utils';
import { useTheme } from '../context';
import type { DashboardState, ActiveRequest } from '../hooks/useDashboardState';

interface HomeViewProps {
  state: DashboardState;
  activeRequests: ActiveRequest[];
  now: number;
  isErrorsExpanded: boolean;
  showHeaders: boolean;
  columns: number;
}

export function HomeView({ state, activeRequests, now, isErrorsExpanded, showHeaders, columns }: HomeViewProps) {
  const { theme } = useTheme();

  // Get all plan names from providerUsage and localQuota (all configured plans)
  const allPlanNames = new Set([
    ...Object.keys(state.providerUsage),
    ...Object.keys(state.localQuota),
  ]);

  // Build plan usages for all plans, merging with actual usage data
  const allPlansWithUsage = Array.from(allPlanNames).map(name => {
    const usage = state.planUsages[name] || { requests: 0, tokens: 0, rpm: 0 };
    return [name, usage] as [string, typeof usage];
  });

  // Sort by requests (most usage first)
  const topPlans = allPlansWithUsage
    .sort((a, b) => b[1].requests - a[1].requests);

  const topModels = Object.entries(state.modelUsages)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 3);

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      {/* Active Requests */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title="⏳ ACTIVE REQUESTS" color={theme.brand} />
        {showHeaders && (
          <Box flexDirection="row" marginBottom={0}>
            <Box width={3}><Text color={theme.muted} bold>St</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={10}><Text color={theme.muted} bold>Req ID</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={5}><Text color={theme.muted} bold>Time</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={10}><Text color={theme.muted} bold>API Key</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={16}><Text color={theme.muted} bold>Model</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={12}><Text color={theme.muted} bold>Plan</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box width={6}><Text color={theme.muted} bold>Score</Text></Box>
            <Text color={theme.muted}>│ </Text>
            <Box flexGrow={1}><Text color={theme.muted} bold>URL</Text></Box>
          </Box>
        )}
        {activeRequests.length > 0 ? (
          activeRequests.map(req => {
            const endTime = req.endTime || now;
            const duration = Math.floor((endTime - req.startTime) / 1000);
            const displayUrl = req.url.split('?')[0];
            const statusIcon = req.status === 'completed' ? '✅' : req.status === 'failed' ? '❌' : '⚡';
            return (
              <Box key={req.id} flexDirection="row">
                <Box width={3}><Text>{statusIcon}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={10}><Text color={theme.brand} wrap="truncate-end">{req.id}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={5}><Text color={theme.brand}>{duration}s</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={10}><Text color={theme.brand} wrap="truncate-end">{req.apiKey || 'Auth...'}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={16}><Text color={theme.brand} wrap="truncate-end">{req.model || 'Unknown'}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={12}><Text color={theme.brand} wrap="truncate-end">{req.planName || 'Routing...'}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box width={6}><Text color={theme.brand}>{req.score !== undefined ? req.score.toFixed(2) : '-'}</Text></Box>
                <Text color={theme.muted}>│ </Text>
                <Box flexGrow={1}><Text wrap="truncate-end">{displayUrl}</Text></Box>
              </Box>
            );
          })
        ) : (
          <Text color={theme.muted}>  No active requests.</Text>
        )}
      </Box>

      {/* Errors */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title={`🚨 ERRORS (${state.recentErrors.length})`} color={theme.error} />
        {state.recentErrors.length > 0 ? (
          state.recentErrors.slice(0, isErrorsExpanded ? undefined : 3).map((log, i) => (
            <Box key={i} flexDirection="column">
              <Text color={theme.error} wrap={isErrorsExpanded ? 'wrap' : 'truncate-end'}>
                [{log.level.toUpperCase()}] {log.message}{log.error ? ` — ${log.error.message}` : ''}{log.context?.statusCode ? ` (${log.context.statusCode})` : ''}
              </Text>
              {isErrorsExpanded && (
                <Box paddingLeft={2} flexDirection="column">
                  {log.error && (
                    <Box flexDirection="column" marginBottom={1}>
                      {(log.error.code || log.error.type) && (
                        <Text color={theme.error} wrap="wrap">
                          Error Code: {log.error.code || 'UNKNOWN'} {log.error.type ? `(${log.error.type})` : ''}
                        </Text>
                      )}
                    </Box>
                  )}
                  {log.context && Object.keys(log.context).length > 0 && (
                    <Text color={theme.muted}>{JSON.stringify(log.context, null, 2)}</Text>
                  )}
                </Box>
              )}
            </Box>
          ))
        ) : (
          <Text color={theme.muted}>  No recent errors.</Text>
        )}
      </Box>

      {/* Usage by Plan */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title="📈 USAGE BY PLAN" color={theme.brand} />
        {topPlans.length > 0 ? (
          (() => {
            // Calculate dynamic column widths based on all plans (including those with 0 usage)
            const maxReqStr = Math.max(1, ...allPlansWithUsage.map(([, u]) => formatCompactNumber(u.requests).length));
            const reqWidth = maxReqStr + 4; // " req" suffix
            const maxTokStr = Math.max(1, ...allPlansWithUsage.map(([, u]) => formatCompactNumber(u.tokens).length));
            const tokWidth = maxTokStr + 4; // " tok" suffix
            const rpmWidth = 6; // "xx RPM" max

            // Helper to render bar with centered label and proper coloring
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

            // Build quota text for a window: " 100%/04.15-10:01"
            const quotaText = (percent: number, resetTime?: string): string => {
              const pct = `${percent.toFixed(0)}%`;
              const reset = resetTime ? `/${resetTime}` : '';
              return ` ${pct}${reset}`;
            };

            // Group plans by provider
            const providerGroups: Map<string, Array<[string, typeof topPlans[0][1]]>> = new Map();
            for (const [name, usage] of topPlans) {
              const providerId = state.planProviders[name] || 'unknown';
              const group = providerGroups.get(providerId) || [];
              group.push([name, usage]);
              providerGroups.set(providerId, group);
            }

            // Per provider-group, calculate max quota text width per window slot position
            // so percentage columns align within the same provider
            const groupQuotaWidths: Map<string, number[]> = new Map();
            for (const [providerId, plans] of providerGroups) {
              const slotWidths: number[] = [];
              for (const [name] of plans) {
                const providerData = state.providerUsage[name];
                const localQuotaData = state.localQuota[name];
                if (providerData && providerData.windows.length > 0) {
                  providerData.windows.forEach((win, i) => {
                    const textLen = quotaText(win.percentage, win.nextResetTime ? formatResetTime(win.nextResetTime) : undefined).length;
                    slotWidths[i] = Math.max(slotWidths[i] ?? 0, textLen);
                  });
                } else if (localQuotaData) {
                  const textLen = quotaText(localQuotaData.percentage, localQuotaData.resetAt ? formatResetTimeFromIso(localQuotaData.resetAt) : undefined).length;
                  slotWidths[0] = Math.max(slotWidths[0] ?? 0, textLen);
                }
              }
              groupQuotaWidths.set(providerId, slotWidths);

              // Also compute separator width for this group
              const maxWindowCount = Math.max(...plans.map(([name]) => {
                const pd = state.providerUsage[name];
                return pd ? pd.windows.length : 1;
              }), 1);
              const totalQuotaWidth = slotWidths.reduce((sum, w) => sum + 10 + w, 0) + (maxWindowCount - 1) * 3;
              const separatorBaseWidth = 10 + 3 + reqWidth + 3 + tokWidth + 3 + rpmWidth + 3;
              slotWidths.push(separatorBaseWidth + totalQuotaWidth); // store separator width at end
            }

            // Render plans with provider separators
            const renderedPlans: React.ReactNode[] = [];
            let isFirstGroup = true;

            for (const [providerId, plans] of providerGroups) {
              const slotWidths = groupQuotaWidths.get(providerId)!;
              const separatorWidth = slotWidths[slotWidths.length - 1] ?? 60; // last element is separator width

              // Add separator between provider groups (except first)
              if (!isFirstGroup) {
                const firstPlanName = plans[0]?.[0] ?? 'unknown';
                renderedPlans.push(
                  <Box key={`sep-${firstPlanName}`} flexDirection="row">
                    <Text color={theme.muted}>{'─'.repeat(separatorWidth)}</Text>
                  </Box>
                );
              }
              isFirstGroup = false;

              // Render plans in this provider group
              for (const [name, usage] of plans) {
                const rpm = usage.rpm || 0;
                const providerData = state.providerUsage[name];
                const localQuotaData = state.localQuota[name];

                const reqStr = formatCompactNumber(usage.requests) + ' req';
                const tokStr = formatCompactNumber(usage.tokens) + ' tok';
                const rpmStr = rpm + ' RPM';

                renderedPlans.push(
                  <Box key={name} flexDirection="row">
                    <Box width={10}><Text>{name}</Text></Box>
                    <Box width={reqWidth}><Text>{reqStr}</Text></Box>
                    <Text color={theme.muted}> | </Text>
                    <Box width={tokWidth}><Text>{tokStr}</Text></Box>
                    <Text color={theme.muted}> | </Text>
                    <Box width={rpmWidth}><Text color={theme.brand}>{rpmStr}</Text></Box>
                    <Text color={theme.muted}> | </Text>
                    {/* Quota display */}
                    {providerData && providerData.windows.length > 0 ? (
                      // Usage-API plans: EXACT windows — pad each slot to group max width
                      providerData.windows.map((win, i) => {
                        const txt = quotaText(win.percentage, win.nextResetTime ? formatResetTime(win.nextResetTime) : undefined);
                        const maxSlotW = slotWidths[i] ?? txt.length;
                        const paddedTxt = txt.padEnd(maxSlotW);
                        return (
                          <React.Fragment key={i}>
                            {i > 0 && <Text color={theme.muted}> | </Text>}
                            {renderQuotaBar(win.percentage, 'EXACT')}
                            <Text color={getColor(win.percentage, theme)}>{paddedTxt}</Text>
                          </React.Fragment>
                        );
                      })
                    ) : localQuotaData ? (
                      // Local quota plans: GUESS
                      (() => {
                        const txt = quotaText(localQuotaData.percentage, localQuotaData.resetAt ? formatResetTimeFromIso(localQuotaData.resetAt) : undefined);
                        const maxSlotW = slotWidths[0] ?? txt.length;
                        const paddedTxt = txt.padEnd(maxSlotW);
                        return (
                          <>
                            {renderQuotaBar(localQuotaData.percentage, 'GUESS')}
                            <Text color={getColor(localQuotaData.percentage, theme)}>{paddedTxt}</Text>
                          </>
                        );
                      })()
                    ) : (
                      <Text color={theme.muted}>no quota</Text>
                    )}
                  </Box>
                );
              }
            }

            return renderedPlans;
          })()
        ) : (
          <Text color={theme.muted}>  No plan usage data.</Text>
        )}
      </Box>

      {/* Usage by Model */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title="📈 USAGE BY MODEL" color={theme.brand} />
        {topModels.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap">
            {(() => {
              const totalRequests = Math.max(1, Object.values(state.modelUsages).reduce((sum, u) => sum + u.requests, 0));
              return topModels.map(([name, usage]) => {
                const percent = Math.min(100, Math.round((usage.requests / totalRequests) * 100));
                return (
                  <Box key={name} marginRight={2}>
                    <Text>{name} </Text>
                    <Text color={getColor(percent, theme)}>{renderBar(percent, 6)} </Text>
                    <Text>{formatCompactNumber(usage.requests)}</Text>
                  </Box>
                );
              });
            })()}
          </Box>
        ) : (
          <Text color={theme.muted}>  No model usage data.</Text>
        )}
      </Box>
    </Box>
  );
}

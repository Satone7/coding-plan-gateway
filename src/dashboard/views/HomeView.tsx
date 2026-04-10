import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor } from '../utils';
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

  // Take top 3 plans and top 3 models by requests
  const topPlans = Object.entries(state.planUsages)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 3);

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
            const totalRequests = Math.max(1, Object.values(state.planUsages).reduce((sum, u) => sum + u.requests, 0));
            const totalTokens = Math.max(1, Object.values(state.planUsages).reduce((sum, u) => sum + u.tokens, 0));

            return topPlans.map(([name, usage]) => {
              const quotaPercent = Math.min(100, Math.round((usage.requests / totalRequests) * 100));
              const tokensPercent = Math.min(100, Math.round((usage.tokens / totalTokens) * 100));
              const rpm = usage.rpm || 0;
              const rpmPercent = Math.min(100, Math.round((rpm / 20) * 100));

              return (
                <Box key={name} flexDirection="row">
                  <Box width={10}><Text>{name}</Text></Box>
                  <Box width={12}><Text color={getColor(quotaPercent, theme)}>{renderBar(quotaPercent, 8)}</Text></Box>
                  <Box width={10}><Text>{formatCompactNumber(usage.requests)} req</Text></Box>
                  <Box width={12}><Text color={getColor(tokensPercent, theme)}>{renderBar(tokensPercent, 8)}</Text></Box>
                  <Box width={10}><Text>{formatCompactNumber(usage.tokens)} tok</Text></Box>
                  <Box width={12}><Text color={getColor(rpmPercent, theme)}>{renderBar(rpmPercent, 8)}</Text></Box>
                  <Box width={10}><Text color={theme.brand}>{rpm} RPM</Text></Box>
                </Box>
              );
            });
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

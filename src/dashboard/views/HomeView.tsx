import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { formatCompactNumber, renderBar, getColor } from '../utils';
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
        <Divider width={columns} title="⏳ ACTIVE REQUESTS" color="cyan" />
        {showHeaders && (
          <Box flexDirection="row" marginBottom={0}>
            <Box width={3}><Text color="gray" bold>St</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={10}><Text color="gray" bold>Req ID</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={5}><Text color="gray" bold>Time</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={10}><Text color="gray" bold>API Key</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={16}><Text color="gray" bold>Model</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={12}><Text color="gray" bold>Plan</Text></Box>
            <Text color="gray">│ </Text>
            <Box width={6}><Text color="gray" bold>Score</Text></Box>
            <Text color="gray">│ </Text>
            <Box flexGrow={1}><Text color="gray" bold>URL</Text></Box>
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
                <Text color="gray">│ </Text>
                <Box width={10}><Text color="white" wrap="truncate-end">{req.id}</Text></Box>
                <Text color="gray">│ </Text>
                <Box width={5}><Text color="green">{duration}s</Text></Box>
                <Text color="gray">│ </Text>
                <Box width={10}><Text color="cyan" wrap="truncate-end">{req.apiKey || 'Auth...'}</Text></Box>
                <Text color="gray">│ </Text>
                <Box width={16}><Text color="yellow" wrap="truncate-end">{req.model || 'Unknown'}</Text></Box>
                <Text color="gray">│ </Text>
                <Box width={12}><Text color="blue" wrap="truncate-end">{req.planName || 'Routing...'}</Text></Box>
                <Text color="gray">│ </Text>
                <Box width={6}><Text color="magenta">{req.score !== undefined ? req.score.toFixed(2) : '-'}</Text></Box>
                <Text color="gray">│ </Text>
                <Box flexGrow={1}><Text wrap="truncate-end">{displayUrl}</Text></Box>
              </Box>
            );
          })
        ) : (
          <Text color="gray">  No active requests.</Text>
        )}
      </Box>

      {/* Errors */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title={`🚨 ERRORS (${state.recentErrors.length})`} color="red" />
        {state.recentErrors.length > 0 ? (
          state.recentErrors.slice(0, isErrorsExpanded ? undefined : 3).map((log, i) => (
            <Box key={i} flexDirection="column">
              <Text color="red" wrap={isErrorsExpanded ? 'wrap' : 'truncate-end'}>
                [{log.level.toUpperCase()}] {log.message}{log.error ? ` — ${log.error.message}` : ''}{log.context?.statusCode ? ` (${log.context.statusCode})` : ''}
              </Text>
              {isErrorsExpanded && (
                <Box paddingLeft={2} flexDirection="column">
                  {log.error && (
                    <Box flexDirection="column" marginBottom={1}>
                      {(log.error.code || log.error.type) && (
                        <Text color="redBright" wrap="wrap">
                          Error Code: {log.error.code || 'UNKNOWN'} {log.error.type ? `(${log.error.type})` : ''}
                        </Text>
                      )}
                    </Box>
                  )}
                  {log.context && Object.keys(log.context).length > 0 && (
                    <Text color="gray">{JSON.stringify(log.context, null, 2)}</Text>
                  )}
                </Box>
              )}
            </Box>
          ))
        ) : (
          <Text color="gray">  No recent errors.</Text>
        )}
      </Box>

      {/* Usage by Plan */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title="📈 USAGE BY PLAN" color="magenta" />
        {topPlans.length > 0 ? (
          topPlans.map(([name, usage]) => {
            // Mock quota and tokens percentages if not tracked accurately yet
            const quotaPercent = Math.min(100, Math.round((usage.requests / 1000000) * 100)); 
            const tokensPercent = Math.min(100, Math.round((usage.tokens / 5000000) * 100)); 
            
            return (
              <Box key={name} flexDirection="row">
                <Box width={10}><Text>{name}</Text></Box>
                <Box width={12}><Text color={getColor(quotaPercent)}>{renderBar(quotaPercent, 8)}</Text></Box>
                <Box width={10}><Text>{formatCompactNumber(usage.requests)} req</Text></Box>
                <Box width={12}><Text color={getColor(tokensPercent)}>{renderBar(tokensPercent, 8)}</Text></Box>
                <Box width={15}><Text>{formatCompactNumber(usage.tokens)} tok</Text></Box>
              </Box>
            );
          })
        ) : (
          <Text color="gray">  No plan usage data.</Text>
        )}
      </Box>

      {/* Usage by Model */}
      <Box flexDirection="column" marginBottom={1}>
        <Divider width={columns} title="📈 USAGE BY MODEL" color="magenta" />
        {topModels.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap">
            {topModels.map(([name, usage]) => {
              const percent = Math.min(100, Math.round((usage.requests / 500000) * 100)); 
              return (
                <Box key={name} marginRight={2}>
                  <Text>{name} </Text>
                  <Text color={getColor(percent)}>{renderBar(percent, 6)} </Text>
                  <Text>{formatCompactNumber(usage.requests)}</Text>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Text color="gray">  No model usage data.</Text>
        )}
      </Box>
    </Box>
  );
}

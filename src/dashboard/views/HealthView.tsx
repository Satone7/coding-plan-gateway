import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';
import { useTheme } from '../context';

interface HealthViewProps {
  columns: number;
}

export function HealthView({ columns }: HealthViewProps) {
  const { theme } = useTheme();

  const services = [
    { name: 'Gateway API', status: 'Healthy', latency: '45ms' },
    { name: 'Plan Repository', status: 'Healthy', latency: '12ms' },
    { name: 'Usage Tracker', status: 'Healthy', latency: '8ms' },
    { name: 'Redis Cache', status: 'Degraded', latency: '240ms' },
  ];

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="🏥 SYSTEM HEALTH" color={theme.brand} />
      <Box flexDirection="column" marginTop={1}>
        {services.map(service => (
          <Box key={service.name} flexDirection="row" marginBottom={1}>
            <Box width={20}><Text bold color={theme.brand}>{service.name}</Text></Box>
            <Box width={12}>
              <Text color={service.status === 'Healthy' ? theme.success : theme.error}>
                {service.status === 'Healthy' ? '● ' : '○ '}
                {service.status}
              </Text>
            </Box>
            <Text color={theme.muted}>{service.latency}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

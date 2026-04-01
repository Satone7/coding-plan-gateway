import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from '../components/Divider';

interface HealthViewProps {
  columns: number;
}

export function HealthView({ columns }: HealthViewProps) {
  const services = [
    { name: 'Gateway API', status: 'Healthy', latency: '45ms' },
    { name: 'Plan Repository', status: 'Healthy', latency: '12ms' },
    { name: 'Usage Tracker', status: 'Healthy', latency: '8ms' },
    { name: 'Redis Cache', status: 'Degraded', latency: '240ms' },
  ];

  return (
    <Box flexDirection="column" width="100%" flexGrow={1}>
      <Divider width={columns} title="🏥 SYSTEM HEALTH" color="yellow" />
      <Box flexDirection="column" marginTop={1}>
        {services.map(service => (
          <Box key={service.name} flexDirection="row" marginBottom={1}>
            <Box width={20}><Text bold color="blue">{service.name}</Text></Box>
            <Box width={12}>
              <Text color={service.status === 'Healthy' ? 'green' : 'red'}>
                {service.status === 'Healthy' ? '● ' : '○ '}
                {service.status}
              </Text>
            </Box>
            <Text color="gray">{service.latency}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

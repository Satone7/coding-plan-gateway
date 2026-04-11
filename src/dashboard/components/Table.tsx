import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context';

export interface TableProps {
  data: Record<string, any>[];
  columns?: string[];
}

export function Table({ data, columns }: TableProps) {
  const { theme } = useTheme();

  if (!data || data.length === 0) {
    return <Text color={theme.muted}>No data</Text>;
  }

  const cols = columns || Object.keys(data[0] || {});

  // Calculate column widths
  const colWidths: Record<string, number> = {};
  cols.forEach(col => {
    let max = col.length;
    data.forEach(row => {
      const val = String(row[col] ?? '');
      if (val.length > max) max = val.length;
    });
    colWidths[col] = max + 2; // add padding
  });

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="row">
        {cols.map((col) => (
          <Box key={`header-${col}`} width={colWidths[col]}>
            <Text bold color={theme.brand} underline>{col}</Text>
          </Box>
        ))}
      </Box>
      {/* Rows */}
      {data.map((row, rowIndex) => (
        <Box key={`row-${rowIndex}`} flexDirection="row">
          {cols.map((col) => (
            <Box key={`cell-${rowIndex}-${col}`} width={colWidths[col]}>
              <Text>{String(row[col] ?? '')}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

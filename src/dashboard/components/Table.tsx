import React from 'react';
import { Box, Text } from 'ink';

export interface TableProps {
  data: Record<string, any>[];
  columns?: string[];
}

export function Table({ data, columns }: TableProps) {
  if (!data || data.length === 0) {
    return <Text>No data</Text>;
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
    <Box flexDirection="column" borderStyle="single">
      {/* Header */}
      <Box flexDirection="row" borderBottom={false}>
        {cols.map((col, i) => (
          <Box key={`header-${col}`} width={colWidths[col]} paddingX={1} borderRight={i < cols.length - 1} borderStyle="single" borderTop={false} borderBottom={true} borderLeft={false}>
            <Text bold color="cyan">{col}</Text>
          </Box>
        ))}
      </Box>
      {/* Rows */}
      {data.map((row, rowIndex) => (
        <Box key={`row-${rowIndex}`} flexDirection="row">
          {cols.map((col, colIndex) => (
            <Box key={`cell-${rowIndex}-${col}`} width={colWidths[col]} paddingX={1} borderRight={colIndex < cols.length - 1} borderStyle="single" borderTop={false} borderBottom={false} borderLeft={false}>
              <Text>{String(row[col] ?? '')}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

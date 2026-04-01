import React from 'react';
import { Box, Text } from 'ink';

interface DividerProps {
  width: number;
  title?: string;
  char?: string;
  color?: string;
}

export function Divider({ width, title = '', char = '─', color = 'gray' }: DividerProps) {
  if (title) {
    return (
      <Box flexDirection="row" width="100%">
        <Text color={color}>{title} </Text>
        <Box flexGrow={1}>
          <Text color={color} wrap="truncate-end">
            {char.repeat(Math.max(1, width - title.length - 2))}
          </Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box width="100%">
      <Text color={color} wrap="truncate-end">{char.repeat(width)}</Text>
    </Box>
  );
}

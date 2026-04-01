import React from 'react';
import { Text } from 'ink';

interface DividerProps {
  width: number;
  title?: string;
  char?: string;
  color?: string;
}

export function Divider({ width, title = '', char = '─', color = 'gray' }: DividerProps) {
  if (title) {
    const spaceRemaining = Math.max(0, width - title.length - 1);
    return (
      <Text color={color}>
        {title} {char.repeat(spaceRemaining)}
      </Text>
    );
  }
  return <Text color={color}>{char.repeat(width)}</Text>;
}

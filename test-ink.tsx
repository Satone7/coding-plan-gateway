import React, { useState, useEffect } from 'react';
import { render, Box, Text, useStdout } from 'ink';

const App = () => {
  const { stdout } = useStdout();
  const [size, setSize] = useState({ columns: stdout.columns, rows: stdout.rows });

  useEffect(() => {
    const onResize = () => setSize({ columns: stdout.columns, rows: stdout.rows });
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  return (
    <Box width={size.columns} height={size.rows} borderStyle="round">
      <Text>Width: {size.columns}, Height: {size.rows}</Text>
    </Box>
  );
};

render(<App />);

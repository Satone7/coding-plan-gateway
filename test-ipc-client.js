import * as net from 'net';

const client = net.createConnection({ path: process.env.IPC_SOCKET_PATH || '/tmp/coding-plan-gateway.sock' });

client.on('connect', () => {
  console.log('Connected to IPC server');
});

client.on('data', (data) => {
  console.log('Received from IPC:', data.toString());
});

client.on('end', () => {
  console.log('Disconnected from IPC server');
});

client.on('error', (err) => {
  console.error('IPC client error:', err);
});

import * as net from 'net';
import * as fs from 'fs';
import { logger } from './logger';

export class IpcServer {
  private server: net.Server | null = null;
  private clients: Set<net.Socket> = new Set();
  private socketPath: string;

  constructor(socketPath: string = process.env.IPC_SOCKET_PATH || '/tmp/coding-plan-gateway.sock') {
    this.socketPath = socketPath;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up previous socket file if it exists
      if (fs.existsSync(this.socketPath)) {
        try {
          fs.unlinkSync(this.socketPath);
        } catch (err) {
          logger.error(`Failed to remove old IPC socket at ${this.socketPath}`, err as Error);
          return reject(err);
        }
      }

      this.server = net.createServer((socket) => {
        this.clients.add(socket);
        logger.debug('IPC client connected', { clientsCount: this.clients.size, component: 'ipc-server' });

        socket.on('end', () => {
          this.clients.delete(socket);
          logger.debug('IPC client disconnected', { clientsCount: this.clients.size, component: 'ipc-server' });
        });

        socket.on('error', (err) => {
          this.clients.delete(socket);
          logger.error('IPC client error', err, { clientsCount: this.clients.size, component: 'ipc-server' });
        });
      });

      this.server.on('error', (err) => {
        logger.error('IPC server error', err, { component: 'ipc-server' });
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        logger.info(`IPC server listening on ${this.socketPath}`, { socketPath: this.socketPath, component: 'ipc-server' });
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        return resolve();
      }

      for (const client of this.clients) {
        client.destroy();
      }
      this.clients.clear();

      this.server.close(() => {
        logger.info('IPC server stopped', { component: 'ipc-server' });
        if (fs.existsSync(this.socketPath)) {
          try {
            fs.unlinkSync(this.socketPath);
          } catch (err) {
            logger.warn(`Failed to remove IPC socket at ${this.socketPath}`, { error: (err as Error).message, component: 'ipc-server' });
          }
        }
        this.server = null;
        resolve();
      });
    });
  }

  public broadcast(data: unknown): void {
    if (this.clients.size === 0) {
      return;
    }

    try {
      const message = JSON.stringify(data) + '\n';
      for (const client of this.clients) {
        client.write(message, (err) => {
          if (err) {
            this.clients.delete(client);
            client.destroy();
          }
        });
      }
    } catch (err) {
      // Using console.error here to avoid recursive loop if logger uses broadcast and fails
      console.error('Failed to broadcast IPC message', err);
    }
  }
}

export const ipcServer = new IpcServer();

/**
 * Structured JSON logger for the gateway.
 * Provides consistent, machine-readable log output.
 */

import { stdout, stderr } from 'process';

/**
 * Log levels in order of severity.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log level priority mapping.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Log context with additional metadata.
 */
export interface LogContext {
  /** Request ID for tracing */
  requestId?: string;
  /** Plan ID being processed */
  planId?: number;
  /** Model being used */
  model?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Structured log entry.
 */
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Include timestamps in logs */
  timestamp?: boolean;
  /** Pretty-print JSON (for development) */
  pretty?: boolean;
  /** Service name to include in logs */
  service?: string;
}

/**
 * Structured JSON logger class.
 */
export class Logger {
  private readonly minLevel: number;
  private readonly timestamp: boolean;
  private readonly pretty: boolean;
  private readonly service: string;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = LOG_LEVEL_PRIORITY[options.level ?? 'info'];
    this.timestamp = options.timestamp ?? true;
    this.pretty = options.pretty ?? false;
    this.service = options.service ?? 'coding-plan-gateway';
  }

  /**
   * Log a trace message.
   */
  trace(message: string, context?: LogContext): void {
    this.log('trace', message, context);
  }

  /**
   * Log a debug message.
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message.
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message.
   */
  error(message: string, error?: Error, context?: LogContext): void {
    const entry: LogEntry = {
      timestamp: this.timestamp ? new Date().toISOString() : '',
      level: 'error',
      message,
      context: { ...context, service: this.service },
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.writeLog(entry);
  }

  /**
   * Log a fatal message.
   */
  fatal(message: string, error?: Error, context?: LogContext): void {
    const entry: LogEntry = {
      timestamp: this.timestamp ? new Date().toISOString() : '',
      level: 'fatal',
      message,
      context: { ...context, service: this.service },
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.writeLog(entry);
  }

  /**
   * Create a child logger with additional context.
   */
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context);
  }

  /**
   * Internal log method.
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    const priority = LOG_LEVEL_PRIORITY[level];
    if (priority < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: this.timestamp ? new Date().toISOString() : '',
      level,
      message,
      context: { ...context, service: this.service },
    };

    this.writeLog(entry);
  }

  /**
   * Write log entry to output.
   */
  private writeLog(entry: LogEntry): void {
    const output = entry.level === 'error' || entry.level === 'fatal' ? stderr : stdout;

    if (this.pretty) {
      output.write(this.formatPretty(entry) + '\n');
    } else {
      output.write(JSON.stringify(entry) + '\n');
    }
  }

  /**
   * Format log entry for pretty printing.
   */
  private formatPretty(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      trace: '\x1b[90m',    // Gray
      debug: '\x1b[36m',    // Cyan
      info: '\x1b[32m',     // Green
      warn: '\x1b[33m',     // Yellow
      error: '\x1b[31m',    // Red
      fatal: '\x1b[35m',    // Magenta
    };
    const reset = '\x1b[0m';

    const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
    const level = `${levelColors[entry.level]}${entry.level.toUpperCase().padEnd(5)}${reset}`;
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';

    let output = `${timestamp}${level} ${entry.message}${contextStr}`;

    if (entry.error) {
      output += `\n  ${entry.error.name}: ${entry.error.message}`;
      if (entry.error.stack) {
        output += `\n  ${entry.error.stack.split('\n').slice(1, 4).join('\n  ')}`;
      }
    }

    return output;
  }
}

/**
 * Child logger with bound context.
 */
class ChildLogger {
  constructor(
    private readonly parent: Logger,
    private readonly context: LogContext
  ) {}

  trace(message: string, additionalContext?: LogContext): void {
    this.parent.trace(message, { ...this.context, ...additionalContext });
  }

  debug(message: string, additionalContext?: LogContext): void {
    this.parent.debug(message, { ...this.context, ...additionalContext });
  }

  info(message: string, additionalContext?: LogContext): void {
    this.parent.info(message, { ...this.context, ...additionalContext });
  }

  warn(message: string, additionalContext?: LogContext): void {
    this.parent.warn(message, { ...this.context, ...additionalContext });
  }

  error(message: string, error?: Error, additionalContext?: LogContext): void {
    this.parent.error(message, error, { ...this.context, ...additionalContext });
  }

  fatal(message: string, error?: Error, additionalContext?: LogContext): void {
    this.parent.fatal(message, error, { ...this.context, ...additionalContext });
  }
}

/**
 * Default logger instance.
 */
export const logger = new Logger({
  level: (process.env.LOG_LEVEL as LogLevel) ?? 'info',
  pretty: process.env.NODE_ENV !== 'production',
});

/**
 * Create a request-scoped logger.
 */
export function createRequestLogger(requestId: string): ChildLogger {
  return logger.child({ requestId });
}
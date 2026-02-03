// TestLogger.ts
// Centralized logger for tests with log-level abstraction

export type LogLevel = 'DEBUG' | 'INFO' | 'ERROR';

const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'ERROR';

function shouldLog(level: LogLevel): boolean {
  const levels: LogLevel[] = ['DEBUG', 'INFO', 'ERROR'];
  return levels.indexOf(level) >= levels.indexOf(LOG_LEVEL);
}

export class TestLogger {
  static debug(...args: any[]) {
    if (shouldLog('DEBUG')) {
      // eslint-disable-next-line no-console
      console.debug('[DEBUG]', ...args);
    }
  }

  static info(...args: any[]) {
    if (shouldLog('INFO')) {
      // eslint-disable-next-line no-console
      console.info('[INFO]', ...args);
    }
  }

  static error(...args: any[]) {
    if (shouldLog('ERROR')) {
      // eslint-disable-next-line no-console
      console.error('[ERROR]', ...args);
    }
  }
}

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
       
      console.debug('[DEBUG]', ...args);
    }
  }

  static info(...args: any[]) {
    if (shouldLog('INFO')) {
       
      console.info('[INFO]', ...args);
    }
  }

  static error(...args: any[]) {
    if (shouldLog('ERROR')) {
       
      console.error('[ERROR]', ...args);
    }
  }
}

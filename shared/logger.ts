// UnoSim/shared/logger.ts

export type LogLevel = 'TEST' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
  private sender: string;

  constructor(sender: string) {
    this.sender = sender;
  }

  private log(level: LogLevel, ...args: any[]) {
    const isBrowser = typeof window !== 'undefined';
    const nodeEnv = (typeof process !== 'undefined' && process.env?.NODE_ENV) || undefined;
    const allowDebug = !isBrowser || nodeEnv === 'development' || nodeEnv === 'test';

    // Suppress DEBUG logs in browser when not in development or test
    if (level === 'DEBUG' && !allowDebug) return;

    const message = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');

    if (level === 'TEST') {
      console.log(message);
    } else {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}][${level}][${this.sender}] ${message}`);
    }
  }

  test(message: string) {
    this.log('TEST', message);
  }

  info(message: string) {
    this.log('INFO', message);
  }

  warn(message: string) {
    this.log('WARN', message);
  }

  error(message: string) {
    this.log('ERROR', message);
  }

  debug(message: string) {
    this.log('DEBUG', message);
  }
}
// UnoSim/shared/logger.ts

export type LogLevel = "TEST" | "INFO" | "WARN" | "ERROR" | "DEBUG";

export class Logger {
  private sender: string;

  constructor(sender: string) {
    this.sender = sender;
  }

  private log(level: LogLevel, ...args: any[]) {
    const isBrowser = typeof window !== "undefined";
    const nodeEnv =
      (typeof process !== "undefined" && process.env?.NODE_ENV) || undefined;
    // Suppress DEBUG logs in test environment to prevent console spam in CI/CD
    if (level === "DEBUG" && nodeEnv === "test") return;

    const allowDebug =
      !isBrowser || nodeEnv === "development";

    // Suppress DEBUG logs in browser when not in development
    if (level === "DEBUG" && !allowDebug) return;

    const message = args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");

    // Test-Guard: Catch errors if console stream is closed (happens after tests finish)
    try {
      if (level === "TEST") {
        console.log(message);
      } else {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}][${level}][${this.sender}] ${message}`);
      }
    } catch (err) {
      // Silently ignore logging errors in test environment
      // This prevents "Cannot log after tests are done" errors
      if (nodeEnv !== "test") {
        // In non-test environments, we still want to see the error
        console.error("Logger error:", err);
      }
    }
  }

  test(message: string) {
    this.log("TEST", message);
  }

  info(message: string) {
    this.log("INFO", message);
  }

  warn(message: string) {
    this.log("WARN", message);
  }

  error(message: string) {
    this.log("ERROR", message);
  }

  debug(message: string) {
    this.log("DEBUG", message);
  }
}

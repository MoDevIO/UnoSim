/**
 * ProcessExecutor – Centralized, secure process spawning service
 * 
 * Provides unified process execution with:
 * - Command whitelisting (security)
 * - Argument validation (injection prevention)
 * - Timeout management (resource protection)
 * - Unified logging
 * - Test mockability
 */

import { Logger } from "@shared/logger";

export interface ExecutionOptions {
  timeout?: number;          // ms, 0 = no timeout
  detached?: boolean;        // process group for killing subprocesses
  stdio?: "pipe" | "ignore" | "inherit";
  onData?: (data: Buffer) => void;  // for stdout/stderr capture
  onProcess?: (proc: any) => void;  // for process lifecycle hooks (tests)
}

export interface ExecutionResult {
  code: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

/**
 * Whitelist of allowed commands to prevent arbitrary execution
 */
const ALLOWED_COMMANDS: Record<string, { allowedArgs?: RegExp[] }> = {
  "docker": {
    // Docker command whitelist: allow specific flags and arguments
    allowedArgs: [
      /^--version$/,
      /^--no-color$/,
      /^info$/,
      /^image$/,
      /^inspect$/,
      /^run$/,
      /^[a-z0-9:./-]+$/i, // Image names, paths, config values
    ],
  },
  "arduino-cli": {
    // Arduino CLI whitelisting
    allowedArgs: [
      /^compile$/,
      /^--fqbn$/,
      /^--build-path$/,
      /^arduino:avr:uno$/,
      /^[a-zA-Z0-9._\-/]+$/, // Paths and valid arg values
    ],
  },
  "g\+\+": {
    // g++ is less restricted but still validated
    allowedArgs: [
      /^-[a-z]+$/i, // Flags like -o, -pthread
      /^[a-zA-Z0-9._\-/]+$/, // Paths and filenames
    ],
  },
  "echo": {
    // echo for testing - allow any args
  },
};

/**
 * Validate that command is in whitelist and arguments don't contain shell metacharacters
 */
function validateCommand(command: string, args: string[]): void {
  // Command must be in whitelist
  if (!ALLOWED_COMMANDS[command]) {
    throw new Error(`Command not whitelisted: ${command}`);
  }

  const allowedRegexps = ALLOWED_COMMANDS[command].allowedArgs;
  if (!allowedRegexps) {
    // No restriction for this command
    return;
  }

  // Check each argument against patterns
  for (const arg of args) {
    let isAllowed = false;
    for (const pattern of allowedRegexps) {
      if (pattern.test(arg)) {
        isAllowed = true;
        break;
      }
    }
    if (!isAllowed) {
      // Reject suspicious arguments
      if (/[;&|`$\(\)<>{}]/.test(arg)) {
        throw new Error(`Argument contains shell metacharacters: ${arg}`);
      }
    }
  }
}

export class ProcessExecutor {
  private logger = new Logger("ProcessExecutor");
  private activeProcess: any = null;
  private activeTimeout: NodeJS.Timeout | null = null;

  /**
   * Execute a process with strict validation and timeout management
   */
  async execute(
    command: string,
    args: string[],
    options: ExecutionOptions = {},
  ): Promise<ExecutionResult> {
    // Validate command and arguments
    validateCommand(command, args);

    const { timeout = 20000, detached = false, stdio = "pipe", onData, onProcess } = options;

    // Dynamic import for test mockability
    const { spawn } = await import("child_process");

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const proc = spawn(command, args, {
        stdio: [stdio === "pipe" ? "ignore" : stdio, stdio, stdio],
        detached,
        shell: false, // Critical security: never use shell
      });

      this.activeProcess = proc;

      // Track in global spawnInstances for test cleanup (Vitest pattern)
      try {
        const gs: any = (globalThis as any).spawnInstances;
        if (Array.isArray(gs)) gs.push(proc);
      } catch {}

      // Allow caller to instrument the process (test mocks)
      if (onProcess) {
        try {
          onProcess(proc);
        } catch {}
      }

      // Capture output
      if (stdio === "pipe") {
        if (proc.stdout) {
          proc.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
            if (onData) onData(data);
          });
        }
        if (proc.stderr) {
          proc.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
            if (onData) onData(data);
          });
        }
      }

      // Set timeout if requested
      if (timeout > 0) {
        this.activeTimeout = setTimeout(() => {
          timedOut = true;
          try {
            // Kill process group if detached, otherwise just the process
            if (detached && proc.pid) {
              process.kill(-proc.pid, "SIGKILL");
            } else {
              proc.kill("SIGKILL");
            }
          } catch (err) {
            this.logger.warn(`Failed to kill process: ${err}`);
          }
        }, timeout);
      }

      // Handle process completion
      proc.on("close", (code: number) => {
        if (this.activeTimeout) {
          clearTimeout(this.activeTimeout);
          this.activeTimeout = null;
        }
        this.activeProcess = null;

        const result: ExecutionResult = {
          code,
          stdout: stdio === "pipe" ? stdout : undefined,
          stderr: stdio === "pipe" ? stderr : undefined,
        };

        if (timedOut) {
          result.error = new Error(`Process timeout after ${timeout}ms`);
          this.logger.warn(`${command} timed out: ${result.error.message}`);
        } else if (code !== 0) {
          result.error = new Error(`${command} exit code ${code}: ${stderr}`);
          this.logger.warn(`${command} failed: ${result.error.message}`);
        }

        resolve(result);
      });

      proc.on("error", (err: Error) => {
        if (this.activeTimeout) {
          clearTimeout(this.activeTimeout);
          this.activeTimeout = null;
        }
        this.activeProcess = null;
        this.logger.error(`${command} error: ${err.message}`);
        resolve({
          code: -1,
          error: err,
          stdout: stdio === "pipe" ? stdout : undefined,
          stderr: stdio === "pipe" ? stderr : undefined,
        });
      });
    });
  }

  /**
   * Kill any active process (for cleanup during stop())
   */
  kill(signal: string = "SIGKILL"): void {
    if (this.activeProcess && this.activeProcess.pid) {
      try {
        if (this.activeProcess._isDetached) {
          // Kill process group
          process.kill(-this.activeProcess.pid, signal);
        } else {
          this.activeProcess.kill(signal);
        }
        this.logger.info(`Killed process with signal ${signal}`);
      } catch (err) {
        this.logger.warn(`Failed to kill process: ${err}`);
      }
    }

    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    }
  }

  /**
   * Check if a process is currently running
   */
  get isBusy(): boolean {
    return this.activeProcess !== null;
  }
}

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

import { ChildProcess } from "node:child_process";
import { Logger } from "@shared/logger";
import { config } from "../config";

/**
 * Extend globalThis for test process tracking
 * Note: spawnInstances is an implementation detail for test cleanup support
 */
declare global {
  interface Global {
    spawnInstances?: ChildProcess[];
  }
}

interface ExecutionOptions {
  timeout?: number;          // ms, 0 = no timeout
  detached?: boolean;        // process group for killing subprocesses
  stdio?: "pipe" | "ignore" | "inherit";
  onData?: (data: Buffer) => void;  // for stdout/stderr capture
  onProcess?: (proc: ChildProcess) => void;  // for process lifecycle hooks (tests)
  maxOutputBytes?: number;   // combined captured raw stdout/stderr bytes
}

/** The process was stopped because it exceeded `maxOutputBytes`; the output captured so far is kept. */
export class ProcessOutputLimitError extends Error {
  constructor(readonly maxOutputBytes: number) {
    super(`Process output limit exceeded (${maxOutputBytes} bytes)`);
    this.name = "ProcessOutputLimitError";
  }
}

interface ExecutionResult {
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
      /^pause$/,
      /^unpause$/,
      /^[a-z0-9:./-]+$/i, // Image names, paths, config values
      /^label=unosim\.owner=[A-Za-z0-9._-]+:\d+$/, // Orphaned sandbox sweep filter
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
  "g++": {
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
      if (/[;&|`$(){}]/.test(arg)) {
        throw new Error(`Argument contains shell metacharacters: ${arg}`);
      }
    }
  }
}

export class ProcessExecutor {
  private readonly logger = new Logger("ProcessExecutor");
  private readonly activeExecutions = new Map<ChildProcess, boolean>();
  private stopGeneration = 0;

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

    const {
      timeout = config.timeouts.processExecutionDefaultMs,
      detached = false,
      stdio = "pipe",
      onData,
      onProcess,
      maxOutputBytes = config.sandbox.resources.maxOutputBytes,
    } = options;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
      throw new RangeError("maxOutputBytes must be a positive safe integer");
    }

    // Stop also owns requests waiting for the import, before a child exists.
    const generation = this.stopGeneration;
    // Dynamic import for test mockability
    const { spawn } = await import("node:child_process");
    if (generation !== this.stopGeneration) {
      return { code: -1, error: new Error("Process execution cancelled before spawn") };
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let activeTimeout: NodeJS.Timeout | null = null;
      let capturedBytes = 0;
      let outputError: Error | undefined;

      const proc = spawn(command, args, {
        stdio: [stdio === "pipe" ? "ignore" : stdio, stdio, stdio],
        detached,
        shell: false, // Critical security: never use shell
      });

      this.activeExecutions.set(proc, detached);

      const capture = (data: Buffer, stream: "stdout" | "stderr") => {
        if (settled || outputError || timedOut) return;
        const remaining = maxOutputBytes - capturedBytes;
        const chunk = data.subarray(0, remaining);
        capturedBytes += chunk.byteLength;
        if (stream === "stdout") stdout += chunk.toString();
        else stderr += chunk.toString();
        if (chunk.byteLength > 0 && onData) onData(chunk);
        if (data.byteLength > remaining) {
          outputError = new ProcessOutputLimitError(maxOutputBytes);
          this.signalProcess(proc, detached, "SIGKILL");
        }
      };
      const onStdout = (data: Buffer) => capture(data, "stdout");
      const onStderr = (data: Buffer) => capture(data, "stderr");

      const cleanup = () => {
        settled = true;
        if (activeTimeout) clearTimeout(activeTimeout);
        activeTimeout = null;
        this.activeExecutions.delete(proc);
        proc.stdout?.off?.("data", onStdout);
        proc.stderr?.off?.("data", onStderr);
      };

      // Track in global spawnInstances for test cleanup (Vitest pattern)
      const spawnInstances = (globalThis as any).spawnInstances as ChildProcess[] | undefined;
      if (spawnInstances && Array.isArray(spawnInstances)) {
        spawnInstances.push(proc);
      }

      // Allow caller to instrument the process (test mocks)
      if (onProcess) {
        try {
          onProcess(proc);
        } catch {}
      }

      // Capture output
      if (stdio === "pipe") {
        if (proc.stdout) {
          proc.stdout.on("data", onStdout);
        }
        if (proc.stderr) {
          proc.stderr.on("data", onStderr);
        }
      }

      // Set timeout if requested
      if (timeout > 0) {
        activeTimeout = setTimeout(() => {
          timedOut = true;
          this.signalProcess(proc, detached, "SIGKILL");
        }, timeout);
      }

      // Handle process completion
      proc.on("close", (code: number | null) => {
        if (settled) return;
        cleanup();

        const result: ExecutionResult = {
          code: outputError && code === 0 ? 1 : (code ?? -1),
          stdout: stdio === "pipe" ? stdout : undefined,
          stderr: stdio === "pipe" ? stderr : undefined,
        };

        if (outputError) {
          result.error = outputError;
          this.logger.warn(`${command} exceeded its output limit (${maxOutputBytes} bytes)`);
        } else if (timedOut) {
          result.error = new Error(`Process timeout after ${timeout}ms`);
          this.logger.warn(`${command} timed out: ${result.error.message}`);
        } else if (code !== 0) {
          result.error = new Error(`${command} exit code ${code}`);
          this.logger.warn(`${command} failed with exit code ${code} (${Buffer.byteLength(stderr)} stderr bytes)`);
        }

        resolve(result);
      });

      proc.on("error", (err: Error) => {
        if (settled) return;
        cleanup();
        const errorCode = "code" in err && typeof err.code === "string" ? `, ${err.code}` : "";
        this.logger.error(`${command} process error (${err.name}${errorCode})`);
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
   * Signal every execution owned by this executor (for cleanup during stop()).
   * Each deadline remains armed until its process finishes.
   */
  kill(signal: string | number = "SIGKILL"): void {
    this.stopGeneration += 1;
    for (const [proc, detached] of this.activeExecutions) {
      this.signalProcess(proc, detached, signal);
    }
  }

  private signalProcess(proc: ChildProcess, detached: boolean, signal: string | number): void {
    try {
      if (detached && proc.pid) process.kill(-proc.pid, signal as NodeJS.Signals);
      else proc.kill(signal as NodeJS.Signals);
    } catch (err) {
      this.logger.warn(`Failed to kill process: ${err}`);
    }
  }

  /**
   * Check if a process is currently running
   */
  get isBusy(): boolean {
    return this.activeExecutions.size > 0;
  }
}

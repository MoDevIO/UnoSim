import type { ChildProcess, SpawnOptions } from "node:child_process";
import { Logger } from "@shared/logger";

const logger = new Logger("ProcessController");

/**
 * ProcessController
 *
 * Encapsulates child_process lifecycle and stream forwarding for SandboxRunner.
 *
 * Important concurrency note:
 * - Callbacks (stdout/stderr/close/error) are captured and iterated by the
 *   single wrapper attached to the ChildProcess streams. Consumers should
 *   capture stable callback references before passing them to async code.
 *   This avoids a race where a caller clears or replaces a callback while
 *   an interval/timer (e.g. SerialOutputBatcher) is still invoking it — the
 *   capture-and-check pattern prevents `TypeError: callback is not a function`.
 */

export type StdDataCb = (data: Buffer) => void;
export type StdLineCb = (line: string) => void;
export type CloseCb = (code: number | null) => void;
export type ErrorCb = (err: Error) => void;

export interface IProcessController {
  /**
   * Spawn a child process and return the underlying `ChildProcess` object
   * (or null if spawn failed). Uses dynamic import so mocking works in tests.
   */
  spawn(command: string, args?: string[] | undefined, options?: SpawnOptions | undefined): Promise<import("node:child_process").ChildProcess | null>;
  onStdout(cb: StdDataCb): void;
  onStderr(cb: StdDataCb): void;
  onStderrLine(cb: StdLineCb): void;
  supportsStderrLineStreaming(): boolean;
  onClose(cb: CloseCb): void;
  onError(cb: ErrorCb): void;
  writeStdin(data: string): boolean;
  kill(signal?: NodeJS.Signals | number): void;
  destroySockets(): void;
  hasProcess(): boolean;
  clearListeners(): void;
  /** Returns the PID of the currently active child process, or null. */
  getPid(): number | null;
}

/**
 * ProcessController — encapsulates low-level child_process handling.
 * - centralizes spawn(), signal delivery and stream/event wiring
 * - keeps SandboxRunner free from direct spawn/kill calls
 */
export class ProcessController implements IProcessController {
  private proc: ChildProcess | null = null;
  private stdoutListeners: StdDataCb[] = [];
  private stderrListeners: StdDataCb[] = [];
  private stderrLineListeners: StdLineCb[] = [];
  private closeListeners: CloseCb[] = [];
  private errorListeners: ErrorCb[] = [];
  private stderrReadline: import("node:readline").Interface | null = null;
  private killTimer: NodeJS.Timeout | null = null;

  async spawn(command: string, args: string[] = [], options?: SpawnOptions): Promise<import("node:child_process").ChildProcess | null> {
    // dynamic import ensures test mocks of child_process are applied
    const { spawn } = await import("node:child_process");
    const { createInterface } = await import("node:readline");

    // Ensure we always use pipes so we can drain output and prevent backpressure.
    const spawnOptions: SpawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    };

    // debug logging of spawn attempts goes through policy logger
    logger.debug(`ProcessController.spawn called: ${command} ${args ? args.join(" ") : ""}`);
    logger.debug(`ProcessController.spawn options: ${JSON.stringify(spawnOptions)}`);

    // Destroy any previous process reference
    // spawn with or without options depending on caller
    this.proc = spawn(command, args, spawnOptions);

    // Cleanup stale readline interface from previous process, if any.
    if (this.stderrReadline) {
      try {
        this.stderrReadline.close();
      } catch {
        // ignore
      }
      this.stderrReadline = null;
    }
    // if tests have registered a global spawnInstances array, record it
    try {
      // TypeScript guard: check that globalThis.spawnInstances exists and is an array
      const gs = (globalThis as Record<string, unknown>).spawnInstances;
      if (Array.isArray(gs) && this.proc) {
        gs.push(this.proc);
      }
    } catch {
      /* ignore */
    }

    // attach existing listeners (guard for nullability)
    if (this.proc && this.proc.stdout) {
      this.proc.stdout.on("data", (d: Buffer) => {
        this.stdoutListeners.forEach((cb) => cb(d));
      });
    }

    this._setupStderrHandling(createInterface);
    this._setupKillTimer();
    this._setupProcessEventListeners();

    // return the underlying ChildProcess so callers can inspect it
    return this.proc;
  }

  private _setupStderrHandling(createInterface: (options: any) => import("node:readline").Interface): void {
    if (!this.proc?.stderr) return;

    this.proc.stderr.on("data", (d: Buffer) => {
      if (process.env.NODE_ENV === "test") {
        // convert low-level wrapper events into buffered debug logs
        try {
          logger.debug(`wrapper stderr handler invoked with: ${d.toString()}`);
        } catch {}
      }
      this.stderrListeners.forEach((cb) => cb(d));
    });

    // Type-safe stream handling: verify the stream has our expected methods
    const stderrStream = this.proc.stderr as unknown;
    const canUseReadline =
      stderrStream !== null && 
      typeof stderrStream === 'object' &&
      typeof (stderrStream as Record<string, unknown>).on === "function" &&
      typeof (stderrStream as Record<string, unknown>).resume === "function";

    if (canUseReadline) {
      this.stderrReadline = createInterface({
        input: this.proc.stderr,
        crlfDelay: Infinity,
      });
      this.stderrReadline.on("line", (line: string) => {
        this.stderrLineListeners.forEach((cb) => cb(line));
      });
    }
  }

  private _setupKillTimer(): void {
    // Ensure we don't hang due to child process backpressure (stdout/stderr not drained).
    // If the process is still alive after 25s, force kill it and log a warning.
    if (!this.proc) return;
    
    if (this.killTimer) {
      clearTimeout(this.killTimer);
    }
    this.killTimer = setTimeout(() => {
      if (!this.proc || this.proc.killed) return;
      const pid = this.proc.pid;
      logger.warn(`ProcessController: child process still alive after 25s, killing pid=${pid}`);
      this.kill("SIGKILL");
    }, 25000);
  }

  private _setupProcessEventListeners(): void {
    if (!this.proc) return;

    this.proc.on("close", (code: number | null) => {
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      this.closeListeners.forEach((cb) => cb(code));
    });
    this.proc.on("error", (err: Error) => this.errorListeners.forEach((cb) => cb(err)));
  }

  onStdout(cb: StdDataCb) {
    this.stdoutListeners.push(cb);
    // The active process (if any) has a single wrapper attached in spawn()
    // which iterates over `stdoutListeners`. Do not attach `cb` directly to
    // `proc.stdout` here — that caused duplicate invocations.
  }

  onStderr(cb: StdDataCb) {
    this.stderrListeners.push(cb);
    // Handled by the single stderr wrapper installed in spawn().
  }

  onStderrLine(cb: StdLineCb) {
    this.stderrLineListeners.push(cb);
    // Handled by readline interface installed in spawn().
  }

  supportsStderrLineStreaming(): boolean {
    return this.stderrReadline !== null;
  }

  onClose(cb: CloseCb) {
    this.closeListeners.push(cb);
    // `spawn()` wires a single 'close' handler that will call listeners.
  }

  onError(cb: ErrorCb) {
    this.errorListeners.push(cb);
    // `spawn()` wires a single 'error' handler that will call listeners.
  }

  writeStdin(data: string): boolean {
    try {
      if (!this.proc || !this.proc.stdin) return false;
      return this.proc.stdin.write(data);
    } catch {
      return false;
    }
  }

  kill(signal?: NodeJS.Signals | number): void {
    try {
      if (!this.proc) {
        logger.debug(`ProcessController.kill called but proc is null (signal=${signal})`);
        return;
      }
      const pid = this.proc.pid;
      if (pid == null) {
        logger.debug(`ProcessController.kill: pid is null, sending ${signal}`);
        // Safe cast: signal is known to be NodeJS.Signals | number, which is what kill accepts
        if (typeof signal === 'string') {
          this.proc.kill(signal);
        } else if (typeof signal === 'number') {
          this.proc.kill(signal);
        } else {
          this.proc.kill();
        }
        return;
      }

      logger.debug(`ProcessController.kill: sending ${signal} to pid=${pid}`);

      // For SIGSTOP / SIGCONT send to the entire process group (-pid).
      // This ensures all children of the process (e.g. sub-shells, avr-gcc)
      // receive the signal, not just the direct child.
      // On non-POSIX systems (Windows) fall back to the plain kill.
      const isGroupSignal = signal === "SIGSTOP" || signal === "SIGCONT";
      if (isGroupSignal && typeof signal === 'string') {
        try {
          process.kill(-pid, signal);
          return;
        } catch (err) {
          logger.debug(`ProcessController.kill group signal failed: ${err}`);
          // group kill failed (e.g. process not a group leader) — fall through
        }
      }

      try {
        if (typeof signal === 'string') {
          this.proc.kill(signal);
        } else if (typeof signal === 'number') {
          this.proc.kill(signal);
        } else {
          this.proc.kill();
        }
      } catch (err) {
        logger.debug(`ProcessController.kill direct kill failed: ${err}`);
      }
    } catch (err) {
      logger.debug(`ProcessController.kill outer error: ${err}`);
      // swallow errors — caller should handle state
    }
  }

  destroySockets(): void {
    try {
      if (this.stderrReadline) {
        this.stderrReadline.close();
        this.stderrReadline = null;
      }
    } catch {
      /* ignore */
    }

    try {
      if (!this.proc) return;
      if (this.proc.stdin && !this.proc.stdin.destroyed) {
         
        // @ts-ignore - Node typings: destroy may exist
        this.proc.stdin.destroy();
      }
    } catch {
      /* ignore */
    }

    try {
      if (!this.proc) return;
      if (this.proc.stdout && !this.proc.stdout.destroyed) {
        // @ts-ignore
        this.proc.stdout.destroy();
      }
    } catch {
      /* ignore */
    }

    try {
      if (!this.proc) return;
      if (this.proc.stderr && !this.proc.stderr.destroyed) {
        // @ts-ignore
        this.proc.stderr.destroy();
      }
    } catch {
      /* ignore */
    }
  }

  hasProcess(): boolean {
    return !!this.proc;
  }

  getPid(): number | null {
    return this.proc?.pid ?? null;
  }

  clearListeners(): void {
    this.stdoutListeners = [];
    this.stderrListeners = [];
    this.stderrLineListeners = [];
    this.closeListeners = [];
    this.errorListeners = [];
  }
}

import { spawn } from "child_process";
import type { ChildProcess, SpawnOptions } from "child_process";

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
export type CloseCb = (code: number | null) => void;
export type ErrorCb = (err: Error) => void;

export interface IProcessController {
  spawn(command: string, args?: string[] | undefined, options?: SpawnOptions | undefined): void;
  onStdout(cb: StdDataCb): void;
  onStderr(cb: StdDataCb): void;
  onClose(cb: CloseCb): void;
  onError(cb: ErrorCb): void;
  writeStdin(data: string): boolean;
  kill(signal?: NodeJS.Signals | number): void;
  destroySockets(): void;
  hasProcess(): boolean;
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
  private closeListeners: CloseCb[] = [];
  private errorListeners: ErrorCb[] = [];

  spawn(command: string, args: string[] = [], options?: SpawnOptions) {
    // Destroy any previous process reference
    // spawn with or without options depending on caller
    this.proc = options ? spawn(command, args, options) : spawn(command, args);

    // attach existing listeners (guard for nullability)
    if (this.proc && this.proc.stdout) {
      this.proc.stdout.on("data", (d: Buffer) => this.stdoutListeners.forEach((cb) => cb(d)));
    }
    if (this.proc && this.proc.stderr) {
      this.proc.stderr.on("data", (d: Buffer) => this.stderrListeners.forEach((cb) => cb(d)));
    }

    if (this.proc) {
      this.proc.on("close", (code: number | null) => this.closeListeners.forEach((cb) => cb(code)));
      this.proc.on("error", (err: Error) => this.errorListeners.forEach((cb) => cb(err)));
    }
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
      if (!this.proc) return;
      // forward signal to the underlying process
      this.proc.kill(signal as any);
    } catch {
      // swallow errors — caller should handle state
    }
  }

  destroySockets(): void {
    try {
      if (!this.proc) return;
      if (this.proc.stdin && !this.proc.stdin.destroyed) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
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
}

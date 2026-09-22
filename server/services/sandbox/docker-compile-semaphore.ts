/**
 * SandboxStartSemaphore
 *
 * A lightweight FIFO counting semaphore used to limit Docker sandbox startup
 * operations. It is acquired before docker run and released at RUNTIME_START.
 *
 * This prevents CPU starvation that occurs when many g++ processes compete for
 * resources on the host machine.  The semaphore is acquired before spawning a
 * Docker container and released when the startup phase transitions to runtime
 * (i.e. when [[RUNTIME_START]] is detected in stdout) or when the container
 * exits with an error.
 *
 * Environment variable: SANDBOX_START_MAX_CONCURRENT (default 8)
 */
import { config } from "../../config";

export class SandboxStartSemaphore {
  private readonly queue: Array<{ attempt: () => void; timer: NodeJS.Timeout }> = [];
  private _active = 0;

  constructor(private readonly max: number) {}

  /**
   * Acquire one sandbox-start slot.
   *
   * @param onQueued  Optional callback invoked exactly once when this caller is
   *                  placed in the queue (i.e. no slot is immediately available).
   * @returns         A release function.  Must be called exactly once.
   */
  acquire(onQueued?: () => void, timeoutMs = 60_000): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      let settled = false;
      let attempt: () => void;
      const timer = setTimeout(() => {
        if (settled) return;
        const index = this.queue.findIndex((entry) => entry.attempt === attempt);
        if (index !== -1) this.queue.splice(index, 1);
        settled = true;
        reject(new Error(`Sandbox start slot timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      attempt = () => {
        if (settled) return;
        if (this._active < this.max) {
          settled = true;
          clearTimeout(timer);
          this._active++;
          resolve(this._makeRelease());
        } else {
          onQueued?.();
          this.queue.push({ attempt, timer });
        }
      };

      attempt();
    });
  }

  private _makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent
      released = true;
      this._active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.attempt();
      }
    };
  }

  get activeCount(): number {
    return this._active;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let _instance: SandboxStartSemaphore | null = null;

/**
 * Returns (or lazily creates) the global sandbox-start semaphore.
 * Passing `maxOverride` replaces the configured value and resets the singleton.
 */
export function getSandboxStartSemaphore(maxOverride?: number): SandboxStartSemaphore {
  if (maxOverride !== undefined || _instance === null) {
    const max =
      maxOverride ?? config.capacity.sandboxStartMaxConcurrent;
    _instance = new SandboxStartSemaphore(max);
  }
  return _instance;
}

/** @deprecated Internal compatibility alias; use SandboxStartSemaphore. */
export const DockerCompileSemaphore = SandboxStartSemaphore;
/** @deprecated Internal compatibility alias; use getSandboxStartSemaphore. */
export const getDockerCompileSemaphore = getSandboxStartSemaphore;

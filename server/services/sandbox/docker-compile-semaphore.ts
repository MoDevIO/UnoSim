/**
 * SandboxStartSemaphore
 *
 * A lightweight counting semaphore used to limit Docker sandbox startup
 * operations. It is acquired before docker run and released at RUNTIME_START.
 * Waiters are served oldest first, except that while other subjects wait one
 * subject holds at most half of the slots (work-conserving, no starvation).
 *
 * This prevents CPU starvation that occurs when many g++ processes compete for
 * resources on the host machine.  The semaphore is acquired before spawning a
 * Docker container and released when the startup phase transitions to runtime
 * (i.e. when [[RUNTIME_START]] is detected in stdout) or when the container
 * exits with an error.
 *
 * Environment variables: SANDBOX_START_MAX_CONCURRENT (default 8) and
 * SANDBOX_START_SLOT_TIMEOUT_MS (default 30000 ms)
 */
import { config } from "../../config";

export class SandboxStartSemaphore {
  private readonly queue: Array<{ attempt: () => boolean; timer: NodeJS.Timeout; subject?: string }> = [];
  private readonly activeBySubject = new Map<string, number>();
  private _active = 0;

  constructor(private readonly max: number) {}

  /**
   * Slots one subject may hold while other subjects wait. Work-conserving: with
   * no one else waiting, a subject may use every free slot.
   */
  private get subjectShare(): number {
    return Math.max(1, Math.ceil(this.max / 2));
  }

  /**
   * Acquire one sandbox-start slot.
   *
   * @param onQueued  Optional callback invoked exactly once when this caller is
   *                  placed in the queue (i.e. no slot is immediately available).
   * @param signal    Optional cancellation: an aborted waiter leaves the queue
   *                  and never takes a slot.
   * @param subject   Optional owner; a released slot goes to the oldest waiter whose
   *                  subject holds less than half of the slots before any other.
   * @returns         A release function.  Must be called exactly once.
   */
  acquire(onQueued?: () => void, timeoutMs = 60_000, signal?: AbortSignal, subject?: string): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Sandbox start slot acquire cancelled"));
        return;
      }
      let settled = false;
      let attempt: () => boolean;
      const leaveQueue = (error: Error) => {
        if (settled) return;
        const index = this.queue.findIndex((entry) => entry.attempt === attempt);
        if (index !== -1) this.queue.splice(index, 1);
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      };
      const onAbort = () => leaveQueue(new Error("Sandbox start slot acquire cancelled"));
      const timer = setTimeout(
        () => leaveQueue(new Error(`Sandbox start slot timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });

      attempt = () => {
        if (settled || this._active >= this.max) return false;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.take(subject);
        resolve(this._makeRelease(subject));
        return true;
      };

      if (this.queue.length === 0 && attempt()) return;
      onQueued?.();
      this.queue.push({ attempt, timer, subject });
      this.grantWaiting();
    });
  }

  private take(subject: string | undefined): void {
    this._active++;
    if (subject !== undefined) this.activeBySubject.set(subject, (this.activeBySubject.get(subject) ?? 0) + 1);
  }

  private _makeRelease(subject: string | undefined): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent
      released = true;
      this._active--;
      if (subject !== undefined) {
        const remaining = (this.activeBySubject.get(subject) ?? 1) - 1;
        if (remaining > 0) this.activeBySubject.set(subject, remaining);
        else this.activeBySubject.delete(subject);
      }
      this.grantWaiting();
    };
  }

  /** Hands free slots to waiters: oldest within its subject's share first, otherwise oldest overall. */
  private grantWaiting(): void {
    while (this._active < this.max && this.queue.length > 0) {
      const withinShare = this.queue.findIndex(({ subject }) =>
        subject === undefined || (this.activeBySubject.get(subject) ?? 0) < this.subjectShare);
      const [next] = this.queue.splice(withinShare === -1 ? 0 : withinShare, 1);
      next?.attempt();
    }
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

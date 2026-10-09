import { AsyncLocalStorage } from "node:async_hooks";
import { ExamplesError } from "./examples-error";
import type { SourcePriority } from "./github-api-budget";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class BoundedSemaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly capacity: number,
    private readonly maxQueue: number,
    private readonly capacityError: () => Error,
  ) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw signal.reason ?? new Error("Request aborted");
    if (this.active < this.capacity) {
      this.active++;
      return this.releaseOnce();
    }
    if (this.queue.length >= this.maxQueue) throw this.capacityError();
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason ?? new Error("Request aborted"));
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.queue.shift();
      if (waiter) {
        waiter.signal?.removeEventListener("abort", waiter.onAbort!);
        waiter.resolve(this.releaseOnce());
      } else {
        this.active--;
      }
    };
  }

  getStats(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }
}

export interface ExamplesLoadControllerOptions {
  maxConcurrentLoads: number;
  maxLoadQueue: number;
  maxOutboundFetches: number;
  globalLoadStartsPerMinute: number;
  now?: () => number;
}

/** Outbound fetches kept for loads of the operator's default Course. */
function defaultOutboundReserve(maxOutboundFetches: number): number {
  return maxOutboundFetches > 1 ? Math.max(1, Math.floor(maxOutboundFetches / 4)) : 0;
}

/**
 * Bounds remote examples loading. Loads of the operator's default Course and
 * browser overrides, which any client can trigger with arbitrary repositories
 * and refs, use separate load slots, queues and load-start budgets of the same
 * size, so overrides can never deny the default a load. Outbound fetches share
 * one cap, but override loads may hold only part of it; the rest is reserved
 * for default loads.
 */
export class ExamplesLoadController {
  private readonly loads: Record<SourcePriority, BoundedSemaphore>;
  private readonly outbound: BoundedSemaphore;
  private readonly overrideOutbound: BoundedSemaphore;
  private readonly starts: Record<SourcePriority, number[]> = { default: [], override: [] };
  private readonly loadPriority = new AsyncLocalStorage<SourcePriority>();
  private readonly now: () => number;

  constructor(private readonly options: ExamplesLoadControllerOptions) {
    this.now = options.now ?? Date.now;
    const loadSlots = () => new BoundedSemaphore(
      options.maxConcurrentLoads,
      options.maxLoadQueue,
      () => new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples load capacity is exhausted"),
    );
    this.loads = { default: loadSlots(), override: loadSlots() };
    const fetchSlots = (capacity: number) => new BoundedSemaphore(
      capacity,
      Number.MAX_SAFE_INTEGER,
      () => new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples fetch capacity is exhausted"),
    );
    this.outbound = fetchSlots(options.maxOutboundFetches);
    this.overrideOutbound = fetchSlots(options.maxOutboundFetches - defaultOutboundReserve(options.maxOutboundFetches));
  }

  /** Runs one load; its outbound fetches inherit the priority. */
  async runLoad<T>(operation: () => Promise<T>, signal?: AbortSignal, priority: SourcePriority = "override"): Promise<T> {
    const release = await this.loads[priority].acquire(signal);
    try {
      this.recordLoadStart(priority);
      return await this.loadPriority.run(priority, operation);
    } finally {
      release();
    }
  }

  async runOutbound<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const releaseShare = this.loadPriority.getStore() === "override"
      ? await this.overrideOutbound.acquire(signal)
      : undefined;
    try {
      const release = await this.outbound.acquire(signal);
      try {
        return await operation();
      } finally {
        release();
      }
    } finally {
      releaseShare?.();
    }
  }

  getStats() {
    return {
      loads: this.loads.override.getStats(),
      defaultLoads: this.loads.default.getStats(),
      outbound: this.outbound.getStats(),
    };
  }

  private recordLoadStart(priority: SourcePriority): void {
    const starts = this.starts[priority];
    const now = this.now();
    const cutoff = now - 60_000;
    while (starts[0] !== undefined && starts[0] <= cutoff) starts.shift();
    if (starts.length >= this.options.globalLoadStartsPerMinute) {
      throw new ExamplesError("RATE_LIMITED", "External examples load rate exceeded", 60);
    }
    starts.push(now);
  }
}

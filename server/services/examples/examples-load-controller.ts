import { ExamplesError } from "./examples-error";

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

export class ExamplesLoadController {
  private readonly loads: BoundedSemaphore;
  private readonly outbound: BoundedSemaphore;
  private readonly starts: number[] = [];
  private readonly now: () => number;

  constructor(private readonly options: ExamplesLoadControllerOptions) {
    this.now = options.now ?? Date.now;
    this.loads = new BoundedSemaphore(
      options.maxConcurrentLoads,
      options.maxLoadQueue,
      () => new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples load capacity is exhausted"),
    );
    this.outbound = new BoundedSemaphore(
      options.maxOutboundFetches,
      Number.MAX_SAFE_INTEGER,
      () => new ExamplesError("LOAD_CAPACITY_EXCEEDED", "External examples fetch capacity is exhausted"),
    );
  }

  async runLoad<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.loads.acquire(signal);
    try {
      this.recordLoadStart();
      return await operation();
    } finally {
      release();
    }
  }

  async runOutbound<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.outbound.acquire(signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  getStats() {
    return { loads: this.loads.getStats(), outbound: this.outbound.getStats() };
  }

  private recordLoadStart(): void {
    const now = this.now();
    const cutoff = now - 60_000;
    while (this.starts[0] !== undefined && this.starts[0] <= cutoff) this.starts.shift();
    if (this.starts.length >= this.options.globalLoadStartsPerMinute) {
      throw new ExamplesError("RATE_LIMITED", "External examples load rate exceeded", 60);
    }
    this.starts.push(now);
  }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return result;
}

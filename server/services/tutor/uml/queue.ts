import { UmlRenderError } from "./limits";
interface Waiting {
  start: () => void;
  cancel: () => void;
}
/** FIFO admission with removal of cancelled waiters; every acquired slot has one release. */
export class UmlRenderQueue {
  private active = 0;
  private readonly waiting: Waiting[] = [];
  constructor(
    private readonly maximum: number,
    private readonly backlog: number,
  ) {}
  get activity() {
    return { active: this.active, queued: this.waiting.length };
  }
  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  }
  private release(): void {
    this.active--;
    this.waiting.shift()?.start();
  }
  private acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active < this.maximum) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    if (this.waiting.length >= this.backlog)
      return Promise.reject(new UmlRenderError("render-queue-limit"));
    return new Promise((resolve, reject) => {
      const item: Waiting = {
        start: () => {
          signal?.removeEventListener("abort", item.cancel);
          this.active++;
          resolve(() => this.release());
        },
        cancel: () => {
          const index = this.waiting.indexOf(item);
          if (index >= 0) {
            this.waiting.splice(index, 1);
          }
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        },
      };
      this.waiting.push(item);
      signal?.addEventListener("abort", item.cancel, { once: true });
    });
  }
}

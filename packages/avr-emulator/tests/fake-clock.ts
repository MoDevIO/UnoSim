import type { RuntimeClock } from "../src/index";

/**
 * Artificial wall clock for the emulator. Computing costs wall time:
 * during a task the clock advances `costPerSimMs` milliseconds per simulated
 * millisecond (0.25 = a device four times faster than real time,
 * 2 = real-time factor 0.5). Tasks run in order of their due time.
 */
export class FakeClock implements RuntimeClock {
  costPerSimMs = 0.25;
  waits = 0;
  private wall = 0;
  private sequence = 0;
  private queue: Array<{ due: number; sequence: number; callback: () => void; cancelled: boolean }> = [];
  private task: { wall: number; sim: number } | undefined;

  constructor(private readonly simTimeMs: () => number = () => 0) {}

  now(): number {
    return this.task ? this.task.wall + this.costPerSimMs * (this.simTimeMs() - this.task.sim) : this.wall;
  }

  setTimeout(callback: () => void, ms: number): () => void {
    this.waits++;
    return this.enqueue(callback, this.now() + ms);
  }

  postTask(callback: () => void): () => void {
    return this.enqueue(callback, this.now());
  }

  /** Runs due tasks until wall time `untilMs`; idle time between tasks passes instantly. */
  runUntil(untilMs: number): void {
    for (;;) {
      this.queue = this.queue.filter((t) => !t.cancelled).sort((a, b) => a.due - b.due || a.sequence - b.sequence);
      const next = this.queue[0];
      if (!next || next.due > untilMs) break;
      this.queue.shift();
      this.wall = Math.max(this.wall, next.due);
      this.task = { wall: this.wall, sim: this.simTimeMs() };
      next.callback();
      this.wall = this.now();
      this.task = undefined;
    }
    this.wall = Math.max(this.wall, untilMs);
  }

  private enqueue(callback: () => void, due: number): () => void {
    const entry = { due, sequence: this.sequence++, callback, cancelled: false };
    this.queue.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }
}

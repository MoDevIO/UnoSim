/** Wall clock and scheduling, injectable so tests can run the emulator on an artificial clock. */
export interface RuntimeClock {
  /** Monotonic wall time in milliseconds. */
  now(): number;
  /** Runs `callback` after about `ms` milliseconds; returns a cancel function. */
  setTimeout(callback: () => void, ms: number): () => void;
  /** Runs `callback` as soon as the event loop is free (MessageChannel); returns a cancel function. */
  postTask(callback: () => void): () => void;
}

interface MessagePortLike {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
}

/** The timer APIs that exist in Web Workers and Node; the package is built without DOM types. */
interface TimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Node: runs after pending timers and I/O, so a busy emulator cannot starve them. */
  setImmediate?(callback: () => void): unknown;
  clearImmediate?(handle: unknown): void;
  performance?: { now(): number };
  MessageChannel?: new () => { port1: MessagePortLike; port2: MessagePortLike };
}

/** Clock of the current environment (Web Worker or Node). */
export function systemClock(): RuntimeClock {
  const host = globalThis as unknown as TimerHost;
  const now = host.performance ? () => host.performance?.now() ?? Date.now() : () => Date.now();
  const setTimeoutCancelable = (callback: () => void, ms: number) => {
    const handle = host.setTimeout(callback, ms);
    return () => host.clearTimeout(handle);
  };
  const { setImmediate, clearImmediate } = host;
  if (setImmediate && clearImmediate) {
    return {
      now,
      setTimeout: setTimeoutCancelable,
      postTask(callback) {
        const handle = setImmediate(callback);
        return () => clearImmediate(handle);
      },
    };
  }
  if (!host.MessageChannel) {
    return { now, setTimeout: setTimeoutCancelable, postTask: (callback) => setTimeoutCancelable(callback, 0) };
  }
  // Web Worker: one channel; callbacks queue in order. A plain setTimeout(0)
  // would be clamped to 4 ms after nesting.
  const channel = new host.MessageChannel();
  const queue: Array<{ callback: () => void; cancelled: boolean }> = [];
  channel.port1.onmessage = () => {
    const task = queue.shift();
    if (task && !task.cancelled) task.callback();
  };
  return {
    now,
    setTimeout: setTimeoutCancelable,
    postTask(callback) {
      const task = { callback, cancelled: false };
      queue.push(task);
      channel.port2.postMessage(null);
      return () => {
        task.cancelled = true;
      };
    },
  };
}

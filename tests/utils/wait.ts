/**
 * Polls until `condition` returns a truthy value and returns it; fails after `timeoutMs` naming what it waited
 * for. A function label is evaluated only then, so it can describe the state at the timeout.
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  timeoutMs: number,
  label: string | (() => string),
  pollMs = 25,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await condition();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${typeof label === "function" ? label() : label}`);
    }
    await sleep(pollMs);
  }
}

/** Settles like `promise`, or fails after `timeoutMs` naming what it waited for; the timer is cleared either way. */
export async function within<T>(promise: Promise<T> | undefined, timeoutMs: number, label: string): Promise<T> {
  if (!promise) throw new Error(`Nothing to wait for: ${label}`);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A real observation window: the test watches what happens (or does not happen) during it. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

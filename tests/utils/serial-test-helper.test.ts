import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxRunner } from "../../server/services/sandbox-runner";
import { expectCompleteCounterSequence, extractPlainText, runSketchWithOutput } from "./serial-test-helper";

interface RunCallbacks {
  onOutput: (chunk: string | Buffer, isComplete?: boolean) => void;
  onError: (error: string) => void;
  onExit: (code: number | null) => void;
  onCompileError: (error: string) => void;
  onCompileSuccess: () => void;
}

function fakeRunner(
  run: (callbacks: RunCallbacks) => Promise<void>,
  stop: () => Promise<void> = async () => {},
): SandboxRunner & { stop: ReturnType<typeof vi.fn> } {
  const runner = {
    simulationState: "starting",
    runSketch: vi.fn((callbacks: RunCallbacks) => run(callbacks)),
    stop: vi.fn(stop),
  };
  return runner as unknown as SandboxRunner & {
    stop: ReturnType<typeof vi.fn>;
  };
}

describe("runSketchWithOutput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the runner before resolving a fallback timeout", async () => {
    vi.useFakeTimers();
    let finishStop: (() => void) | undefined;
    const runner = fakeRunner(
      () => new Promise<void>(() => {}),
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );

    const resultPromise = runSketchWithOutput(runner, "sketch", {
      fallbackTimeout: 25,
    });
    await vi.advanceTimersByTimeAsync(25);
    let resolved = false;
    void resultPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(runner.stop).toHaveBeenCalledOnce();
    expect(resolved).toBe(false);
    finishStop?.();
    const result = await resultPromise;

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Timeout waiting for compilation/start"),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the runner on compile errors", async () => {
    const runner = fakeRunner(async (callbacks) => {
      callbacks.onCompileError("bad sketch");
    });

    const result = await runSketchWithOutput(runner, "sketch");

    expect(result).toMatchObject({
      success: false,
      error: "Compile: bad sketch",
    });
    expect(runner.stop).toHaveBeenCalledOnce();
  });

  it("stops the runner on runtime errors", async () => {
    const runner = fakeRunner(async (callbacks) => {
      callbacks.onError("runtime failed");
    });

    const result = await runSketchWithOutput(runner, "sketch");

    expect(result).toMatchObject({ success: false, error: "runtime failed" });
    expect(runner.stop).toHaveBeenCalledOnce();
  });

  it("clears the fallback timer after a successful exit", async () => {
    vi.useFakeTimers();
    const runner = fakeRunner(async (callbacks) => {
      callbacks.onCompileSuccess();
      callbacks.onOutput("READY");
      callbacks.onExit(0);
    });

    const result = await runSketchWithOutput(runner, "sketch");

    expect(result).toEqual({ outputs: ["READY\n"], success: true });
    expect(runner.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Feeds output parts to runSketchWithOutput like the execution manager does and returns the recorded text. */
async function record(parts: ReadonlyArray<readonly [string, boolean?]>): Promise<string> {
  const runner = fakeRunner(async (callbacks) => {
    callbacks.onCompileSuccess();
    for (const [part, isComplete] of parts) callbacks.onOutput(part, isComplete);
    callbacks.onExit(0);
  });
  return extractPlainText((await runSketchWithOutput(runner, "sketch")).outputs);
}

const COUNTER = /^(\d+)$/;

describe("serial output recording and counter sequences", () => {
  it("keeps line boundaries: a part ends its line unless isComplete is false", async () => {
    expect(await record([["0", true], ["1", true], ["2"], ["===END 3===", true]])).toBe("0\n1\n2\n===END 3===\n");
    expect(await record([["1", false], ["0", true], ["===END ", false], ["11===", true]])).toBe("10\n===END 11===\n");
  });

  it("accepts a complete sequence, also from fragmented output and with CRLF", async () => {
    const fragmented = await record([
      ...Array.from({ length: 10 }, (_, counter) => [String(counter), true] as const),
      ["1", false], ["0", true], ["===END ", false], ["11===", true],
    ]);

    expect(expectCompleteCounterSequence(fragmented, COUNTER)).toEqual({ total: 11 });
    expect(expectCompleteCounterSequence("0\r\n1\r\n===END 2===\r\n", COUNTER)).toEqual({ total: 2 });
  });

  it("rejects output without counters or without an end marker", () => {
    expect(() => expectCompleteCounterSequence("===END 3===\n", COUNTER)).toThrow("Received 0 of 3 counters");
    expect(() => expectCompleteCounterSequence("===END 0===\n", COUNTER)).toThrow("empty counter sequence");
    expect(() => expectCompleteCounterSequence("0\n1\n2\n", COUNTER)).toThrow("No end marker");
    expect(() => expectCompleteCounterSequence("012===END===", COUNTER)).toThrow("No end marker");
  });

  it("rejects a sequence that lost its start, an inner element, its end or a whole line's payload", () => {
    expect(() => expectCompleteCounterSequence("1\n2\n===END 3===\n", COUNTER)).toThrow("Counter 0 expected at position 0, got 1");
    expect(() => expectCompleteCounterSequence("0\n2\n===END 3===\n", COUNTER)).toThrow("Counter 1 expected at position 1, got 2");
    expect(() => expectCompleteCounterSequence("0\n1\n===END 3===\n", COUNTER)).toThrow("Received 2 of 3 counters");
    expect(() => expectCompleteCounterSequence("0\n1\n1\n===END 3===\n", COUNTER)).toThrow("Counter 2 expected at position 2, got 1");
    expect(() => expectCompleteCounterSequence("0\n1\n2\n3\n===END 3===\n", COUNTER)).toThrow("Received 4 counters, but the sketch reported 3");
    expect(() => expectCompleteCounterSequence("000000:XX\n000001:X\n===END 2===\n", /^(\d{6}):X{2}$/)).toThrow("Received 1 of 2 counters");
  });

  it("does not let fragments that lose their line break pass as counters", async () => {
    // Recording without the line boundaries (the previous helper) turns 0, 1, 2 into "012".
    expect(() => expectCompleteCounterSequence("012===END 3===", COUNTER)).toThrow("No end marker");
  });
});

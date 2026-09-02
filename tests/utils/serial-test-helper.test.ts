import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxRunner } from "../../server/services/sandbox-runner";
import { runSketchWithOutput } from "./serial-test-helper";

interface RunCallbacks {
  onOutput: (chunk: string | Buffer) => void;
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

    expect(result).toEqual({ outputs: ["READY"], success: true });
    expect(runner.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

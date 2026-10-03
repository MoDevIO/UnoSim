import { afterEach, describe, expect, it, vi } from "vitest";
import { performCompilation } from "../../../../../server/services/sandbox/execution-phases/prepare-phase";
import * as gatekeeperModule from "../../../../../server/services/unified-gatekeeper";

describe("prepare-phase wait timer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves no pending timer once the compile slot was granted", async () => {
    vi.useFakeTimers();
    const release = vi.fn();
    vi.spyOn(gatekeeperModule, "getUnifiedGatekeeper").mockReturnValue({
      acquireCompileSlotHighPriority: vi.fn().mockResolvedValue(release),
    } as never);

    await performCompilation(
      "/tmp/sketch.cpp",
      "/tmp/sketch",
      { code: "", onOutput: vi.fn(), onError: vi.fn() } as never,
      { processController: {} } as never,
      {
        localCompiler: { compile: vi.fn().mockResolvedValue(undefined), makeExecutable: vi.fn().mockResolvedValue(undefined) } as never,
        logger: { error: vi.fn() } as never,
        transitionTo: vi.fn(),
      },
    );

    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

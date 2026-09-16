import { describe, expect, it, vi } from "vitest";
import { runDockerStart } from "../../../../../server/services/sandbox/execution-phases/start-phase";

describe("Docker start phase", () => {
  it("keeps the simulation out of RUNNING after Docker spawn", async () => {
    const processController = {
      clearListeners: vi.fn(),
      spawn: vi.fn().mockResolvedValue(undefined),
    };
    const transitionTo = vi.fn();
    const state = {
      processController,
      processStartTime: null,
    } as any;

    await runDockerStart(
      { sketchDir: "/tmp/sketch", containerName: "unosim-test-container" },
      state,
      { processController, transitionTo },
    );

    expect(processController.spawn).toHaveBeenCalledOnce();
    expect(state.processStartTime).not.toBeNull();
    expect(transitionTo).not.toHaveBeenCalled();
  });
});

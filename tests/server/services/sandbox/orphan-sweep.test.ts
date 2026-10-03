import { describe, expect, it, vi } from "vitest";
import { runDockerStart } from "../../../../server/services/sandbox/execution-phases/start-phase";
import {
  removeOrphanedSandboxContainers,
  sandboxOwner,
  SANDBOX_OWNER_LABEL,
} from "../../../../server/services/sandbox/orphan-sweep";

const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };

describe("sandbox ownership label", () => {
  it("is host and process specific and limited to label-safe characters", () => {
    expect(sandboxOwner("lab-host_01.example", 4242)).toBe("lab-host_01.example:4242");
    expect(sandboxOwner("we!rd host", 1)).toBe("we-rd-host:1");
  });

  it("is attached to every sandbox container next to other labels", async () => {
    const processController = { clearListeners: vi.fn(), spawn: vi.fn().mockResolvedValue(undefined) };
    const args = await runDockerStart(
      { sketchDir: "/tmp/sketch", containerName: "unosim-sandbox-x", labels: ["unosim.capacity-test-run-id=run-1"] },
      { processController, processStartTime: null } as never,
      { processController: processController as never, transitionTo: vi.fn() },
    );

    expect(args.join(" ")).toContain(`--label ${SANDBOX_OWNER_LABEL}=${sandboxOwner()}`);
    expect(args.join(" ")).toContain("--label unosim.capacity-test-run-id=run-1");
  });
});

describe("removeOrphanedSandboxContainers", () => {
  it("removes every container that carries this backend's owner label", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "abc123\ndef456\n", stderr: "" })
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const removed = await removeOrphanedSandboxContainers({ execute }, "host:1", logger);

    expect(removed).toBe(2);
    expect(execute).toHaveBeenNthCalledWith(1, "docker", ["ps", "-aq", "--filter", `label=${SANDBOX_OWNER_LABEL}=host:1`], expect.anything());
    expect(execute).toHaveBeenCalledWith("docker", ["rm", "-f", "abc123"], expect.anything());
    expect(execute).toHaveBeenCalledWith("docker", ["rm", "-f", "def456"], expect.anything());
  });

  it("does nothing without leftovers and never throws on Docker errors", async () => {
    const empty = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await expect(removeOrphanedSandboxContainers({ execute: empty }, "host:1", logger)).resolves.toBe(0);
    expect(empty).toHaveBeenCalledOnce();

    const failing = vi.fn().mockRejectedValue(new Error("daemon down"));
    await expect(removeOrphanedSandboxContainers({ execute: failing }, "host:1", logger)).resolves.toBe(0);
  });
});

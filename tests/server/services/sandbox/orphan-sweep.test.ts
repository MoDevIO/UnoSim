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
    expect(sandboxOwner("lab-host_01.example", 4242, undefined)).toBe("lab-host_01.example:4242");
    expect(sandboxOwner("we!rd host", 1, undefined)).toBe("we-rd-host:1");
  });

  it("is the deployment, not the process, when an instance ID is configured", () => {
    // A redeployed backend: new container hostname, same PID 1, same deployment.
    expect(sandboxOwner("3f2a9c1d0b7e", 1, "classroom")).toBe("instance.classroom");
    expect(sandboxOwner("9e8d7c6b5a4f", 1, "classroom")).toBe(sandboxOwner("3f2a9c1d0b7e", 1, "classroom"));
    expect(sandboxOwner("3f2a9c1d0b7e", 1, "other")).not.toBe("instance.classroom");
    // Process owners always contain ':', instance owners never.
    expect(sandboxOwner("instance.classroom", 1, undefined)).not.toBe("instance.classroom");
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

  it("removes the others when one container cannot be removed, and reports the failure", async () => {
    const warn = vi.fn();
    const execute = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "ps") return { code: 0, stdout: "a1\nb2\nc3\n", stderr: "" };
      if (args[2] === "b2") return { code: 1, stdout: "", stderr: "Error: removal in progress" };
      if (args[2] === "c3") throw new Error("timeout");
      return { code: 0, stdout: "", stderr: "" };
    });

    const removed = await removeOrphanedSandboxContainers({ execute }, "instance.x", { ...logger, warn });

    expect(removed).toBe(1);
    expect(execute).toHaveBeenCalledWith("docker", ["rm", "-f", "a1"], expect.anything());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("b2"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("c3"));
    expect(warn).toHaveBeenCalledWith("2 orphaned sandbox container(s) of instance.x could not be removed");
  });

  it("is idempotent: vanished containers count as removed and a second sweep is a no-op", async () => {
    const warn = vi.fn();
    const execute = vi.fn()
      .mockResolvedValueOnce({ code: 0, stdout: "gone\n", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "Error response from daemon: No such container: gone" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await expect(removeOrphanedSandboxContainers({ execute }, "instance.x", { ...logger, warn })).resolves.toBe(1);
    await expect(removeOrphanedSandboxContainers({ execute }, "instance.x", { ...logger, warn })).resolves.toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("reports a failed listing instead of silently finding nothing", async () => {
    const warn = vi.fn();
    const execute = vi.fn().mockResolvedValue({ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" });

    await expect(removeOrphanedSandboxContainers({ execute }, "instance.x", { ...logger, warn })).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not list"));
  });
});

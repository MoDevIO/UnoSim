import { describe, expect, it, vi } from "vitest";
import {
  arduinoToolchain,
  artifactDeliveryAllowed,
  assertCompileSandboxImage,
} from "../../../../server/services/compiler/toolchain";

describe("arduino toolchain by profile (plan P2.4)", () => {
  it("compiles in the backend locally and in the compile sandbox in Docker", () => {
    expect(arduinoToolchain("local").kind).toBe("local");
    expect(arduinoToolchain("docker").kind).toBe("sandbox");
  });

  it("delivers the flash image in both profiles: locally to the developer, in Docker from the sandbox", () => {
    expect(artifactDeliveryAllowed("local")).toBe(true);
    expect(artifactDeliveryAllowed("docker")).toBe(true);
  });
});

describe("assertCompileSandboxImage", () => {
  it("does not look for the image in the local profile", async () => {
    const execute = vi.fn();
    await assertCompileSandboxImage({ execute }, "unosim-compile-sandbox:test", "local");
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes when the image exists in the Docker profile", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 0, stdout: "[]" });
    await assertCompileSandboxImage({ execute }, "unosim-compile-sandbox:test", "docker");
    expect(execute).toHaveBeenCalledWith("docker", ["image", "inspect", "unosim-compile-sandbox:test"], expect.objectContaining({ stdio: "pipe" }));
  });

  it("refuses to start in the Docker profile without the image and names how to build it", async () => {
    const execute = vi.fn().mockResolvedValue({ code: 1, stderr: "No such image" });
    await expect(assertCompileSandboxImage({ execute }, "unosim-compile-sandbox:test", "docker")).rejects.toThrow(
      /unosim-compile-sandbox:test is not available; build it with npm run build:compile-sandbox/,
    );
  });
});

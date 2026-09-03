import { describe, expect, it } from "vitest";
import { DockerCommandBuilder } from "../../../server/services/docker-command-builder";

describe("DockerCommandBuilder", () => {
  it("limits a sandbox to its writable sketch mount and bounded tmpfs", () => {
    const command = DockerCommandBuilder.buildSecureRunCommand({
      sketchDir: "/tmp/unosim-sketch",
      memoryMB: 256,
      cpuLimit: "0.25",
      pidsLimit: 50,
      imageName: "unosim-sandbox:latest",
      command: ["sh", "-c", "true"],
    });

    expect(command).toContain("--network");
    expect(command[command.indexOf("--network") + 1]).toBe("none");
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop");
    expect(command[command.indexOf("--cap-drop") + 1]).toBe("ALL");
    expect(command).toContain("--tmpfs");
    expect(command[command.indexOf("--tmpfs") + 1]).toBe(
      "/tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m",
    );
    expect(command).toContain("/tmp/unosim-sketch:/sandbox:rw");
    expect(command).not.toContain("ARDUINO_CACHE_DIR");
  });

  it("keeps the executable out of the noexec temporary filesystem", () => {
    expect(DockerCommandBuilder.buildCompileAndRunCommand().at(-1)).toContain(
      "-o /sandbox/sketch",
    );
    expect(DockerCommandBuilder.buildCompileAndRunCommand().at(-1)).toContain(
      "&& /sandbox/sketch",
    );
  });
});

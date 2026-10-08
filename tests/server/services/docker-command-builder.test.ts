import { describe, expect, it } from "vitest";
import { DockerCommandBuilder } from "../../../server/services/docker-command-builder";

describe("DockerCommandBuilder", () => {
  it("keeps source read-only and gives runtime writes a bounded scratch tmpfs", () => {
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
    expect(command).toContain("/tmp/unosim-sketch:/sandbox:ro");
    expect(command).toContain(
      "/sandbox-work:rw,nosuid,nodev,exec,mode=1777,size=64m,nr_inodes=4096",
    );
    expect(command).not.toContain("ARDUINO_CACHE_DIR");
  });

  it("compiles from the read-only source mount and runs the bounded scratch executable", () => {
    expect(DockerCommandBuilder.buildCompileAndRunCommand(7200).at(-1)).toContain(
      "-I/sandbox /sandbox/sketch.cpp -o /sandbox-work/sketch",
    );
    expect(DockerCommandBuilder.buildCompileAndRunCommand(7200).at(-1)).toContain(
      "cd /sandbox-work && ./sketch",
    );
  });
  it("bounds the whole container by an independent hard lifetime", () => {
    const command = DockerCommandBuilder.buildCompileAndRunCommand(7200);
    expect(command.slice(0, 5)).toEqual(["timeout", "--signal=KILL", "7200", "sh", "-c"]);
  });

  it("passes the user ID and group ID into the Docker command", () => {
    const command = DockerCommandBuilder.buildSecureRunCommand({
      sketchDir: "/tmp/sketch",
      memoryMB: 256,
      cpuLimit: "0.25",
      pidsLimit: 50,
      imageName: "unosim-sandbox:latest",
      command: ["sh", "-c", "true"],
      user: "1001:1001",
    });
    expect(command).toContain("--user");
    expect(command[command.indexOf("--user") + 1]).toBe("1001:1001");
  });

  it("adds optional labels for test-owned sandbox attribution", () => {
    const command = DockerCommandBuilder.buildSecureRunCommand({
      sketchDir: "/tmp/sketch",
      memoryMB: 256,
      cpuLimit: "0.25",
      pidsLimit: 50,
      imageName: "unosim-sandbox:latest",
      command: ["sh", "-c", "true"],
      labels: ["unosim.capacity-test-run-id=capacity_123"],
    });

    expect(command[command.indexOf("--label") + 1]).toBe(
      "unosim.capacity-test-run-id=capacity_123",
    );
  });
});

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../shared/logger";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ProcessExecutor } from "../../../server/services/process-executor";
import { DockerCommandBuilder } from "../../../server/services/docker-command-builder";
import { config } from "../../../server/config";

describe("ProcessExecutor diagnostic logging", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("retains compiler stderr for callers without copying it into logs or errors", async () => {
    const diagnostic = "F01_COMPILER_DIAGNOSTIC_SENTINEL";
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 1234,
    });
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr?.emit("data", Buffer.from(diagnostic));
        child.emit("close", 1);
      });
      return child;
    });
    const warn = vi.spyOn(Logger.prototype, "warn");

    const result = await new ProcessExecutor().execute("echo", [], { timeout: 0 });

    expect(result.stderr).toBe(diagnostic);
    expect(result.error?.message).not.toContain(diagnostic);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(diagnostic);
  });
});

describe("ProcessExecutor FQBN allowlist (plan P2.2)", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it.each(["arduino:avr:uno", "arduino:avr:nano:cpu=atmega328", "arduino:avr:mega:cpu=atmega2560", "ATTinyCore:avr:attinyx5:chip=85,clock=8internal"])(
    "lets arduino-cli compile for the catalog FQBN %s",
    async (fqbn) => {
      const child = new EventEmitter() as ChildProcess;
      Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1 });
      spawnMock.mockImplementation(() => {
        queueMicrotask(() => child.emit("close", 0));
        return child;
      });

      await new ProcessExecutor().execute("arduino-cli", ["compile", "--fqbn", fqbn, "/tmp/sketch"], { timeout: 0 });

      expect(spawnMock).toHaveBeenCalledOnce();
    },
  );

  it.each(["esp32:esp32:esp32", "arduino:avr:uno:extra", "arduino:avr:nano", ""])("refuses the FQBN %j without starting a process", async (fqbn) => {
    await expect(new ProcessExecutor().execute("arduino-cli", ["compile", "--fqbn", fqbn, "/tmp/sketch"], { timeout: 0 })).rejects.toThrow(/FQBN is not in the board catalog/);

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does not look at the FQBN of other commands or of calls without --fqbn", async () => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1 });
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await new ProcessExecutor().execute("arduino-cli", ["--version"], { timeout: 0 });

    expect(spawnMock).toHaveBeenCalledOnce();
  });
});

describe("ProcessExecutor compile container isolation (plan P2.4)", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  const compileRun = () => DockerCommandBuilder.buildCompileSandboxCommand({
    sketch: { dir: "/tmp/unosim-x/0f1e", target: "/sketch/0f1e" },
    memoryMB: 512,
    cpuLimit: "1",
    pidsLimit: 128,
    tmpfsMB: 256,
    imageName: config.compilation.sandbox.image,
    containerName: "unosim-compile-test",
    labels: ["unosim.owner=test:1"],
    command: ["unosim-compile", "60", "compile", "--fqbn", "arduino:avr:uno", "/sketch/0f1e"],
  });

  it("starts the compile container that DockerCommandBuilder builds", async () => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1 });
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await new ProcessExecutor().execute("docker", compileRun(), { timeout: 0 });

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it.each<[string, (args: string[]) => string[]]>([
    ["with a network", (args) => args.map((arg, index) => (args[index - 1] === "--network" ? "bridge" : arg))],
    ["without a read-only root", (args) => args.filter((arg) => arg !== "--read-only")],
    ["with capabilities", (args) => args.map((arg, index) => (args[index - 1] === "--cap-drop" ? "NET_RAW" : arg))],
    ["with a writable mount", (args) => args.map((arg) => arg.replace(/:ro$/, ":rw"))],
    ["with the Docker socket", (args) => [...args.slice(0, 2), "-v", "/var/run/docker.sock:/var/run/docker.sock:ro", ...args.slice(2)]],
    ["privileged", (args) => [...args.slice(0, 2), "--privileged", ...args.slice(2)]],
  ])("refuses a compile container %s without starting a process", async (_name, change) => {
    await expect(new ProcessExecutor().execute("docker", change(compileRun()), { timeout: 0 })).rejects.toThrow(/not isolated/);

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

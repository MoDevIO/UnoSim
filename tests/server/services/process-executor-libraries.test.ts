import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ProcessExecutor } from "../../../server/services/process-executor";
import { SKETCH_FILE_MACRO_PROPERTY } from "../../../server/services/compiler/library-build-flags";

function succeedingChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 1 });
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  return child;
}

describe("ProcessExecutor and project libraries (SSOT Libraries §10)", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("lets arduino-cli compile with package paths and the fixed __FILE__ property", async () => {
    succeedingChild();

    await new ProcessExecutor().execute("arduino-cli", [
      "compile", "--fqbn", "arduino:avr:uno", "--library", "/libs/AUnit-1.7.1/AUnit", "--build-property", SKETCH_FILE_MACRO_PROPERTY, "/tmp/sketch",
    ], { timeout: 0 });

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it("refuses any other build property", async () => {
    await expect(new ProcessExecutor().execute("arduino-cli", [
      "compile", "--fqbn", "arduino:avr:uno", "--build-property", "compiler.cpp.extra_flags=-include /etc/passwd", "/tmp/sketch",
    ], { timeout: 0 })).rejects.toThrow(/not allowed/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("passes the given environment on top of the inherited one", async () => {
    succeedingChild();

    await new ProcessExecutor().execute("arduino-cli", ["--version"], { timeout: 0, env: { ARDUINO_DIRECTORIES_USER: "/isolated/user" } });

    const options = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env.ARDUINO_DIRECTORIES_USER).toBe("/isolated/user");
    expect(options.env.PATH).toBe(process.env.PATH);
  });

  it("keeps the inherited environment when none is given", async () => {
    succeedingChild();

    await new ProcessExecutor().execute("arduino-cli", ["--version"], { timeout: 0 });

    expect(spawnMock.mock.calls[0][2]).not.toHaveProperty("env");
  });
});

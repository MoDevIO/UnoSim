import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../../shared/logger";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { ProcessExecutor } from "../../../server/services/process-executor";

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

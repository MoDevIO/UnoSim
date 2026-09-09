import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessExecutor } from "../../../server/services/process-executor";
import { LocalCompiler } from "../../../server/services/local-compiler";
import { SketchFileBuilder } from "../../../server/services/sketch-file-builder";
import { spawn } from "node:child_process";

describe("LocalCompiler public compile behavior", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
    temporaryDirectories.length = 0;
  });

  async function createSketchWorkspace(): Promise<{
    root: string;
    sketchFile: string;
    executableFile: string;
    coreArchive: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "unosim-local-compiler-"));
    temporaryDirectories.push(root);
    const sketchFile = join(root, "sketch.cpp");
    const executableFile = join(root, "bin", "sketch");
    const coreArchive = join(root, "core.a");
    await writeFile(sketchFile, "int main() { return 0; }", "utf8");
    await writeFile(coreArchive, "core archive", "utf8");
    return { root, sketchFile, executableFile, coreArchive };
  }

  it("runs Arduino CLI and g++ with the expected arguments and returns an executable", async () => {
    const workspace = await createSketchWorkspace();
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute").mockImplementation(
      async (command, args) => {
        if (command === "g++") {
          await writeFile(args[args.indexOf("-o") + 1], "compiled executable", "utf8");
        }
        return { code: 0, stdout: "compile ok", stderr: "" };
      },
    );
    const onProcess = vi.fn();

    await new LocalCompiler().compile(
      workspace.sketchFile,
      workspace.executableFile,
      workspace.coreArchive,
      onProcess,
    );

    expect(execute).toHaveBeenCalledWith(
      "arduino-cli",
      expect.arrayContaining([
        "compile",
        "--fqbn",
        "arduino:avr:uno",
        "--build-path",
      ]),
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(execute).toHaveBeenCalledWith(
      "g++",
      ["-I", workspace.root, workspace.sketchFile, workspace.coreArchive, "-o", workspace.executableFile, "-pthread"],
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(onProcess).not.toHaveBeenCalled();
    await expect(readFile(workspace.executableFile, "utf8")).resolves.toBe("compiled executable");
  });

  it("exposes the compile lifecycle through isBusy while ProcessExecutor is active", async () => {
    const workspace = await createSketchWorkspace();
    const originalExecute = ProcessExecutor.prototype.execute;
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute").mockImplementation(
      function (command, args, options) {
        if (command === "g++") {
          return originalExecute.call(this, command, args, options);
        }
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      },
    );
    const compiler = new LocalCompiler();
    const observedBusyStates: boolean[] = [];

    await compiler.compile(
      workspace.sketchFile,
      workspace.executableFile,
      undefined,
      () => observedBusyStates.push(compiler.isBusy),
    );

    expect(execute).toHaveBeenCalledWith(
      "g++",
      ["-I", workspace.root, workspace.sketchFile, "-o", workspace.executableFile, "-pthread"],
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(observedBusyStates).toEqual([true]);
    expect(compiler.isBusy).toBe(false);
    await expect(readFile(workspace.executableFile)).resolves.toBeTruthy();
  });

  it("removes a stale executable before compiling again and preserves the new artifact", async () => {
    const workspace = await createSketchWorkspace();
    await mkdir(join(workspace.root, "bin"), { recursive: true });
    await writeFile(workspace.executableFile, "stale executable", "utf8");
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute").mockImplementation(
      async (command, args) => {
        if (command === "g++") {
          await writeFile(args[args.indexOf("-o") + 1], "fresh executable", "utf8");
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    );

    await new LocalCompiler().compile(workspace.sketchFile, workspace.executableFile);

    expect(execute).toHaveBeenCalledTimes(2);
    await expect(readFile(workspace.executableFile, "utf8")).resolves.toBe("fresh executable");
  });

  it("normalizes compiler stderr and rejects failed compilation", async () => {
    const workspace = await createSketchWorkspace();
    vi.spyOn(ProcessExecutor.prototype, "execute").mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "/tmp/temp/abc123/sketch.cpp:4: error: invalid syntax",
      error: new Error("g++ failed"),
    });

    await expect(
      new LocalCompiler().compile(workspace.sketchFile, workspace.executableFile),
    ).rejects.toThrow("sketch.ino:4: error: invalid syntax");
  });

  it("retries a transient compiler failure and succeeds on the second attempt", async () => {
    const workspace = await createSketchWorkspace();
    let compilationAttempts = 0;
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute").mockImplementation(
      async (command, args) => {
        if (command === "g++") {
          compilationAttempts += 1;
          if (compilationAttempts === 2) {
            await writeFile(args[args.indexOf("-o") + 1], "retry executable", "utf8");
            return { code: 0, stdout: "", stderr: "" };
          }
          throw new Error("temporary compiler failure");
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    );

    await new LocalCompiler().compile(workspace.sketchFile, workspace.executableFile);

    expect(compilationAttempts).toBe(2);
    expect(execute).toHaveBeenCalledTimes(3);
    await expect(readFile(workspace.executableFile, "utf8")).resolves.toBe("retry executable");
  });

  it("compiles and runs a multi-file sketch whose header includes Arduino.h", async () => {
    const root = await mkdtemp(join(tmpdir(), "unosim-arduino-header-"));
    temporaryDirectories.push(root);

    const files = await new SketchFileBuilder(root).build(
      '#include "header.h"\nvoid setup() { printFromHeader(); }',
      "header-sketch",
      [{
        name: "header.h",
        content: "#pragma once\n#include <Arduino.h>\ninline void printFromHeader() { Serial.println(\"header ok\"); }\n",
      }],
    );

    const originalExecute = ProcessExecutor.prototype.execute;
    vi.spyOn(ProcessExecutor.prototype, "execute").mockImplementation(
      function (command, args, options) {
        if (command === "arduino-cli") {
          return Promise.resolve({ code: 0, stdout: "", stderr: "" });
        }
        return originalExecute.call(this, command, args, options);
      },
    );

    await new LocalCompiler().compile(files.sketchFile, files.exeFile);

    const simulation = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const process = spawn(files.exeFile, [], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        process.kill("SIGKILL");
        reject(new Error("simulation timed out"));
      }, 5000);
      process.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });
      process.once("error", reject);
      process.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });
    });

    expect(simulation.code).toBe(0);
    expect(simulation.stderr).toContain("[[SERIAL_EVENT:");
  });

  it("reports a missing sketch before invoking the compiler process", async () => {
    const workspace = await createSketchWorkspace();
    await rm(workspace.sketchFile);
    const execute = vi.spyOn(ProcessExecutor.prototype, "execute");

    await expect(
      new LocalCompiler().compile(workspace.sketchFile, workspace.executableFile),
    ).rejects.toThrow("sketch file vanished before g++ spawn");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe("arduino-cli");
  });
});

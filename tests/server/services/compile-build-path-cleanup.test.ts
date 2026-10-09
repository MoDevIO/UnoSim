import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArduinoCompiler } from "../../../server/services/arduino-compiler";
import * as cliRunner from "../../../server/services/compiler/cli-runner";

const HEX = Buffer.from(":00000001FF\n");
let root: string;

/** Stands in for arduino-cli: writes typical build artifacts into the build path. */
function fakeCli(success: boolean) {
  return vi.spyOn(cliRunner, "compileWithArduinoCli").mockImplementation(async (_sketchFile, cliConfig) => {
    if (cliConfig.buildPath) {
      await mkdir(join(cliConfig.buildPath, "sketch"), { recursive: true });
      await writeFile(join(cliConfig.buildPath, "sketch", "sketch.ino.cpp.o"), "object");
      await writeFile(join(cliConfig.buildPath, "sketch.ino.hex"), HEX);
    }
    return success
      ? { success: true, output: "Sketch uses 1 bytes.\n\nBoard: Arduino UNO", binary: HEX }
      : { success: false, output: "", errors: "sketch.ino:1:1: error: boom" };
  });
}

function uniqueSketch(): string {
  return `// ${randomUUID()}\nvoid setup(){}\nvoid loop(){}\n`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "unosim-build-path-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("compile build paths", () => {
  it("leaves no per-sketch build directory behind after many distinct compiles", async () => {
    fakeCli(true);
    const compiler = await ArduinoCompiler.create();
    const buildOutput = join(root, "build-output");

    for (let index = 0; index < 20; index++) {
      // The compile worker's layout: one build path per sketch hash, created before the compile.
      const buildPath = join(buildOutput, `hash-${index}`);
      await mkdir(buildPath, { recursive: true });
      const result = await compiler.compile(uniqueSketch(), undefined, root, {
        buildPath,
        hexCacheDir: join(root, "hex-cache"),
      });
      expect(result.success).toBe(true);
      expect(result.binary).toEqual(HEX);
    }

    expect(await readdir(buildOutput)).toEqual([]);
    // The HEX cache keeps the useful artifact.
    expect((await readdir(join(root, "hex-cache"))).some((entry) => entry.endsWith(".hex"))).toBe(true);
  });

  it("removes the build path of a failed compile", async () => {
    fakeCli(false);
    const compiler = await ArduinoCompiler.create();
    const buildPath = join(root, "build-output", "failed");
    await mkdir(buildPath, { recursive: true });

    const result = await compiler.compile(uniqueSketch(), undefined, root, { buildPath, hexCacheDir: join(root, "hex-cache") });

    expect(result.success).toBe(false);
    expect(await readdir(join(root, "build-output"))).toEqual([]);
  });

  it("removes the build path when the compile is answered from the cache", async () => {
    const cli = fakeCli(true);
    const compiler = await ArduinoCompiler.create();
    const code = uniqueSketch();
    const hexCacheDir = join(root, "hex-cache");
    await compiler.compile(code, undefined, root, { buildPath: join(root, "build-output", "first"), hexCacheDir });
    const cachedPath = join(root, "build-output", "cached");
    await mkdir(cachedPath, { recursive: true });

    await compiler.compile(code, undefined, root, { buildPath: cachedPath, hexCacheDir });

    expect(cli).toHaveBeenCalledTimes(1);
    expect(await readdir(join(root, "build-output"))).toEqual([]);
  });

  it("gives a compile without an explicit build path its own temporary one and removes it", async () => {
    const cli = fakeCli(true);
    const compiler = await ArduinoCompiler.create();

    await compiler.compile(uniqueSketch(), undefined, root, { hexCacheDir: join(root, "hex-cache") });

    // Without a build path arduino-cli keeps one directory per (random) sketch path in its own cache.
    const buildPath = cli.mock.calls[0][1].buildPath;
    expect(buildPath).toBeDefined();
    expect(buildPath!.startsWith(root)).toBe(true);
    expect((await readdir(root)).filter((entry) => entry !== "hex-cache")).toEqual([]);
  });
});

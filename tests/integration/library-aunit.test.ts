import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSimulationImage, loadSimulationImage, runHeadless } from "../../packages/avr-emulator/src/index";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { config } from "../../server/config";
import { readProvidedLibraries, resolveCompileLibraries } from "../../server/services/libraries/library-service";
import type { ResolvedLibrary } from "../../shared/libraries";

/**
 * Evidence for AUnit 1.7.1 on Uno + browser emulation (SSOT Libraries §12): the
 * package from the isolated provisioning compiles, and the emulator runs passing,
 * failing and timed-out tests with the serial summary of the original library.
 * Provisions storage/libraries first (downloads AUnit once).
 */
const AUNIT = { name: "AUnit", version: "1.7.1" };

describe("AUnit 1.7.1 on Uno + browser emulation (real toolchain)", () => {
  let compiler: ArduinoCompiler;
  let root: string;
  let libraries: readonly ResolvedLibrary[];

  beforeAll(async () => {
    execFileSync(process.execPath, [resolve(__dirname, "../../scripts/provision-libraries.mjs"), "--root", config.compilation.librariesDir], { stdio: "pipe" });
    const resolution = resolveCompileLibraries([AUNIT], "uno", await readProvidedLibraries(config.compilation.librariesDir));
    if (!resolution.ok) throw new Error(resolution.messages.join("; "));
    libraries = resolution.libraries;
    compiler = new ArduinoCompiler();
    root = await mkdtemp(join(tmpdir(), "unosim-aunit-it-"));
  }, 180_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function run(code: string, simMs: number): Promise<string> {
    const result = await compiler.compile(`// ${randomUUID()}\n${code}`, undefined, undefined, {
      board: "uno",
      fqbn: "arduino:avr:uno",
      libraries,
      buildPath: join(root, randomUUID()),
      hexCacheDir: join(root, "hex-cache"),
    });
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex: result.binary!.toString("utf8") }));
    return runHeadless(image, { simMs }).serial.get(0) ?? "";
  }

  it("reports passing and failing assertions and the summary, naming the sketch without a path", async () => {
    const output = await run([
      "#include <AUnit.h>",
      "test(addition) { assertEqual(2 + 3, 5); }",
      "test(wrong) { assertEqual(2 + 2, 5); }",
      "void setup() { Serial.begin(115200); }",
      "void loop() { aunit::TestRunner::run(); }",
    ].join("\n"), 2_000);

    expect(output).toContain("TestRunner started on 2 test(s).");
    expect(output).toContain("Test addition passed.");
    expect(output).toMatch(/^sketch\.ino:4: Assertion failed: \(4\) == \(5\)\.\r?$/m);
    expect(output).toContain("Test wrong failed.");
    expect(output).toContain("TestRunner summary: 1 passed, 1 failed, 0 skipped, 0 timed out, out of 2 test(s).");
    expect(output).not.toMatch(/\/(?:tmp|var|private|sketch|Users|home)\//);
  });

  it("times out every test still open at the shared runner deadline, measured in emulated time", async () => {
    const output = await run([
      "#include <AUnit.h>",
      "testing(aSlowCooperative) { delay(700); }",
      "test(bAddition) { assertEqual(2 + 3, 5); }",
      "test(cWrong) { assertEqual(2 + 2, 5); }",
      "testing(dNeverDone) { }",
      "void setup() { Serial.begin(115200); aunit::TestRunner::setTimeout(1); }",
      "void loop() { aunit::TestRunner::run(); }",
    ].join("\n"), 3_000);

    expect(output).toContain("Test aSlowCooperative timed out.");
    expect(output).toContain("Test dNeverDone timed out.");
    expect(output).toContain("TestRunner summary: 1 passed, 1 failed, 0 skipped, 2 timed out, out of 4 test(s).");
  });

  it("also times out simple tests that had not reached their first loop when the deadline passed", async () => {
    const output = await run([
      "#include <AUnit.h>",
      "testing(aSlowCooperative) { delay(1100); }",
      "test(bAddition) { assertEqual(2 + 3, 5); }",
      "void setup() { Serial.begin(115200); aunit::TestRunner::setTimeout(1); }",
      "void loop() { aunit::TestRunner::run(); }",
    ].join("\n"), 3_000);

    expect(output).toContain("Test bAddition timed out.");
    expect(output).toContain("TestRunner summary: 0 passed, 0 failed, 0 skipped, 2 timed out, out of 2 test(s).");
  });

  it("does not find AUnit without the project requirement, whatever the host sketchbook holds", async () => {
    const result = await compiler.compile(`#include <AUnit.h>\n// ${randomUUID()}\nvoid setup() {}\nvoid loop() {}\n`, undefined, undefined, {
      board: "uno",
      fqbn: "arduino:avr:uno",
      buildPath: join(root, randomUUID()),
      hexCacheDir: join(root, "hex-cache"),
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/AUnit\.h: No such file or directory/);
  });
});

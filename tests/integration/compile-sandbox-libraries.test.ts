import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildSimulationImage, loadSimulationImage, runHeadless } from "../../packages/avr-emulator/src/index";
import { type CompileSandboxSettings, compileInSandbox, readSandboxProvidedLibraries } from "../../server/services/compiler/sandboxed-cli-runner";
import { resolveCompileLibraries } from "../../server/services/libraries/library-service";
import { ProcessExecutor } from "../../server/services/process-executor";
import { getFastTmpBaseDir } from "../../shared/utils/temp-paths";

/**
 * Project libraries in the real compile sandbox image (SSOT Libraries §10): the image
 * provides AUnit with the catalog checksum, a compile uses exactly that package, and a
 * library assertion names the sketch without the container path.
 */
const enabled = process.env.NODE_ENV === "test" && process.env.UNOSIM_SERVER_MODE === "docker";
const maybeDescribe = enabled ? describe : describe.skip;

const SETTINGS: CompileSandboxSettings = {
  image: process.env.COMPILE_SANDBOX_IMAGE ?? "unosim-compile-sandbox:latest",
  memoryMB: 512,
  cpuLimit: "1",
  pidsLimit: 128,
  tmpfsMB: 256,
  timeoutMs: 60_000,
  owner: `compile-libraries.${process.pid}`,
};

maybeDescribe("compile sandbox with project libraries", () => {
  const work = mkdtempSync(join(getFastTmpBaseDir(), "unosim-sandbox-libraries-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  function sketch(name: string, source: string): string {
    mkdirSync(join(work, name), { recursive: true });
    const file = join(work, name, `${name}.ino`);
    writeFileSync(file, source);
    return file;
  }

  it("provides AUnit 1.7.1 with the catalog checksum and builds with it", async () => {
    const provided = await readSandboxProvidedLibraries(new ProcessExecutor(), SETTINGS);
    const resolution = resolveCompileLibraries([{ name: "AUnit", version: "1.7.1" }], "uno", provided);
    expect(resolution).toMatchObject({ ok: true, libraries: [{ name: "AUnit", dir: "/opt/unosim/libraries/AUnit-1.7.1/AUnit" }] });
    if (!resolution.ok) return;

    const result = await compileInSandbox(
      sketch("aunit", "#include <AUnit.h>\ntest(wrong) { assertEqual(2 + 2, 5); }\nvoid setup() { Serial.begin(115200); }\nvoid loop() { aunit::TestRunner::run(); }\n"),
      { fqbn: "arduino:avr:uno", libraryDirs: resolution.libraries.map((library) => library.dir) },
      new ProcessExecutor(),
      SETTINGS,
    );

    expect(result.success).toBe(true);
    const output = runHeadless(loadSimulationImage(buildSimulationImage({ board: "uno", hex: result.binary!.toString("utf8") })), { simMs: 1_000 }).serial.get(0) ?? "";
    expect(output).toMatch(/^sketch\.ino:2: Assertion failed/m);
    expect(output).not.toContain("/sketch/");
  }, 120_000);

  it("finds no library without the requirement", async () => {
    const result = await compileInSandbox(sketch("bare", "#include <AUnit.h>\nvoid setup() {}\nvoid loop() {}\n"), { fqbn: "arduino:avr:uno" }, new ProcessExecutor(), SETTINGS);

    expect(result.success).toBe(false);
    expect(result.errors).toMatch(/AUnit\.h: No such file or directory/);
  }, 120_000);
});

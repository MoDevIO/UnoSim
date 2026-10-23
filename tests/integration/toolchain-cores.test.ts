import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_CATALOG } from "../../shared/boards";
import { compileWithArduinoCli } from "../../server/services/compiler/cli-runner";
import { ProcessExecutor } from "../../server/services/process-executor";

/**
 * Plan P2.3: the pinned cores compile for every board of the catalog with the
 * local toolchain, and the version checks agree with the version files.
 */
describe("toolchain for all boards (real arduino-cli)", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "unosim-cores-it-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each(["scripts/check-arduino-avr-core-version.sh", "scripts/check-attinycore-version.sh"])("%s accepts the installed core", (script) => {
    expect(execFileSync("sh", [script], { encoding: "utf8" })).toMatch(/^Verified /);
  });

  it.each(BOARD_CATALOG.map((board) => [board.id, board.fqbn] as const))("compiles for %s (%s) to a HEX", async (id, fqbn) => {
    const sketchDir = join(root, `cores_${id}`);
    await mkdir(sketchDir, { recursive: true });
    const sketchFile = join(sketchDir, `cores_${id}.ino`);
    await writeFile(sketchFile, "void setup(){ Serial.begin(9600); pinMode(1, OUTPUT); }\nvoid loop(){ digitalWrite(1, HIGH); Serial.println(analogRead(A1)); delay(10); }\n");

    const result = await compileWithArduinoCli(sketchFile, { fqbn, buildPath: join(root, `build_${id}`) }, new ProcessExecutor());

    expect(result.success, result.errors).toBe(true);
    expect(result.binary?.toString("utf8")).toMatch(/^:[0-9A-F]{10}/);
    expect(result.elf?.subarray(0, 4).toString("latin1")).toBe("\x7fELF");
  }, 120_000);
});

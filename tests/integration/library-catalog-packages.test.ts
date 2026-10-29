import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSimulationImage, loadSimulationImage, runHeadless } from "../../packages/avr-emulator/src/index";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { config } from "../../server/config";
import { LIBRARY_CATALOG, readProvidedLibraries, resolveCompileLibraries } from "../../server/services/libraries/library-service";
import { type BoardId, getBoard } from "../../shared/boards";
import type { LibraryRequirement } from "../../shared/libraries";

/**
 * Evidence for the hardware-free catalog packages (SSOT Libraries §12): each
 * minimal example compiles with its provisioned package and runs in the browser
 * emulation of Uno, Nano and Mega 2560, with observable serial results. Extra
 * sketches cover invalid JSON. Provisions storage/libraries first.
 */
const BOARDS: readonly BoardId[] = ["uno", "nano", "mega2560"];

function example(name: string): { requirement: LibraryRequirement; code: string } {
  const entry = LIBRARY_CATALOG.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`${name} is not in the catalog`);
  return {
    requirement: { name: entry.name, version: entry.version },
    code: readFileSync(resolve(__dirname, "../../public/examples", entry.examples[0].path), "utf8"),
  };
}

const lines = (output: string) => output.split(/\r?\n/).filter((line) => line !== "");

describe("catalog packages on Uno, Nano and Mega 2560 + browser emulation (real toolchain)", () => {
  let compiler: ArduinoCompiler;
  let root: string;

  beforeAll(async () => {
    execFileSync(process.execPath, [resolve(__dirname, "../../scripts/provision-libraries.mjs"), "--root", config.compilation.librariesDir], { stdio: "pipe" });
    compiler = new ArduinoCompiler();
    root = await mkdtemp(join(tmpdir(), "unosim-catalog-it-"));
  }, 300_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function run(board: BoardId, requirement: LibraryRequirement, code: string, simMs: number): Promise<string> {
    const resolution = resolveCompileLibraries([requirement], board, await readProvidedLibraries(config.compilation.librariesDir));
    if (!resolution.ok) throw new Error(resolution.messages.join("; "));
    const result = await compiler.compile(`// ${randomUUID()}\n${code}`, undefined, undefined, {
      board,
      fqbn: getBoard(board).fqbn,
      libraries: resolution.libraries,
      buildPath: join(root, randomUUID()),
      hexCacheDir: join(root, "hex-cache"),
    });
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    const image = loadSimulationImage(buildSimulationImage({ board, hex: result.binary!.toString("utf8") }));
    return runHeadless(image, { simMs }).serial.get(0) ?? "";
  }

  describe.each(BOARDS)("on %s", (board) => {
    it("elapsedMillis: the fast and slow messages keep their intervals without delay()", async () => {
      const { requirement, code } = example("elapsedMillis");
      const output = await run(board, requirement, code, 2_600);
      const at = (kind: string) => lines(output).flatMap((line) => {
        const match = new RegExp(String.raw`^${kind} at (\d+)$`).exec(line);
        return match ? [Number(match[1])] : [];
      });

      const fast = at("fast");
      const slow = at("slow");
      expect(fast.length).toBeGreaterThanOrEqual(9);
      expect(slow.length).toBe(2);
      fast.forEach((time, index) => expect(Math.abs(time - 250 * (index + 1))).toBeLessThanOrEqual(5));
      slow.forEach((time, index) => expect(Math.abs(time - 1_000 * (index + 1))).toBeLessThanOrEqual(5));
    });

    it("CircularBuffer: overflow drops the oldest values and reading keeps the order", async () => {
      const { requirement, code } = example("CircularBuffer");
      const output = lines(await run(board, requirement, code, 300));

      expect(output).toEqual([
        "push 1",
        "push 2",
        "push 3",
        "push 4",
        "push 5 - overflow, oldest value dropped",
        "push 6 - overflow, oldest value dropped",
        "size 4 of 4",
        "read 3 4 5 6",
        "buffer empty",
      ]);
    });

    it("ArduinoJson: reads an object, changes a value, writes it and reports invalid input", async () => {
      const { requirement, code } = example("ArduinoJson");
      const output = lines(await run(board, requirement, code, 300));

      expect(output).toEqual([
        "sensor: temperature",
        "count before: 3",
        '{"sensor":"temperature","value":21.5,"count":4}',
        "invalid input: IncompleteInput",
      ]);
    });

    it("Time: the software clock starts at the given date and advances second by second", async () => {
      const { requirement, code } = example("Time");
      const output = lines(await run(board, requirement, code, 3_500));

      expect(output).toEqual([
        "2026-01-01 12:00:00",
        "2026-01-01 12:00:01",
        "2026-01-01 12:00:02",
        "2026-01-01 12:00:03",
      ]);
    });
  });

  it("ArduinoJson tells malformed, incomplete and empty input apart and keeps a valid document", async () => {
    const { requirement } = example("ArduinoJson");
    const output = lines(await run("uno", requirement, [
      "#include <ArduinoJson.h>",
      "void check(const char* input) {",
      "  StaticJsonDocument<64> doc;",
      "  DeserializationError error = deserializeJson(doc, input);",
      "  Serial.println(error.c_str());",
      "}",
      "void setup() {",
      "  Serial.begin(115200);",
      "  check(\"{oops}\");",
      "  check(\"[1,2\");",
      "  check(\"\");",
      "  check(\"[1,2,3]\");",
      "}",
      "void loop() {}",
    ].join("\n"), 300));

    expect(output).toEqual(["InvalidInput", "IncompleteInput", "EmptyInput", "Ok"]);
  });

  it("does not find a catalog package without its project requirement", async () => {
    const result = await compiler.compile(`#include <TimeLib.h>\n// ${randomUUID()}\nvoid setup() {}\nvoid loop() {}\n`, undefined, undefined, {
      board: "uno",
      fqbn: "arduino:avr:uno",
      buildPath: join(root, randomUUID()),
      hexCacheDir: join(root, "hex-cache"),
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/TimeLib\.h: No such file or directory/);
  });
});

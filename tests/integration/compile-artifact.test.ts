import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeBase64, loadSimulationImage } from "../../packages/avr-emulator/src/index";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { parseSimulationArtifact } from "../../shared/simulation-artifact";

/**
 * Plan P2.5 with the real toolchain: the artifact of a compile is a valid
 * image for the board, carries the symbols of the ELF, and a repeated compile
 * answers from the cache with the same artifact.
 */
const SKETCH = (marker: string) => `// ${marker}\nvoid setup() { Serial.begin(9600); pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(10); digitalWrite(13, LOW); delay(10); }\n`;

describe("compile artifact (real toolchain)", () => {
  let compiler: ArduinoCompiler;
  let root: string;

  beforeAll(async () => {
    compiler = new ArduinoCompiler();
    root = await mkdtemp(join(tmpdir(), "unosim-artifact-it-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    ["uno", "arduino:avr:uno"],
    ["nano", "arduino:avr:nano:cpu=atmega328"],
  ] as const)("builds a valid artifact for %s that the emulator package accepts", async (board, fqbn) => {
    const options = { board, fqbn, buildPath: join(root, `build-${board}`), hexCacheDir: join(root, "hex-cache") };
    const code = SKETCH(randomUUID());

    const first = await compiler.compile(code, undefined, undefined, options);
    const artifact = parseSimulationArtifact(first.artifact);

    expect(first.success).toBe(true);
    expect(artifact?.board).toBe(board);
    expect(decodeBase64(artifact?.flashBase64 ?? "")).toHaveLength(artifact?.flashBytes ?? -1);
    expect(artifact?.symbols.data.__bss_end).toBeGreaterThanOrEqual(0x100);
    const loaded = loadSimulationImage(artifact);
    expect(loaded.board).toBe(board);
    expect(loaded.flashBytes).toBe(artifact?.flashBytes);

    const second = await compiler.compile(code, undefined, undefined, { ...options, buildPath: join(root, `again-${board}`) });
    expect(second.artifact).toEqual(first.artifact);
  }, 120_000);
});

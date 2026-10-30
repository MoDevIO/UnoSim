import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArduinoCompiler } from "../../../server/services/arduino-compiler";
import { config } from "../../../server/config";
import * as cliRunner from "../../../server/services/compiler/cli-runner";
import * as toolchainInfo from "../../../server/services/compiler/toolchain-info";
import { buildSketchHash } from "../../../server/services/workers/compile-worker-utils";

/**
 * Plan P2.5: the compile result carries the artifact; a cache entry is only
 * served under the identity it was built with (E15).
 */
const fixtures = join(__dirname, "../../../packages/avr-emulator/tests/fixtures");
const HEX = readFileSync(join(fixtures, "uno-blink.hex"));
const ELF = readFileSync(join(fixtures, "uno-blink-nolto.elf"));
const toolchain = { arduinoCli: "1.5.1", cores: [{ id: "arduino:avr", version: "1.8.8" }], librariesFingerprint: "f".repeat(64) };

let root: string;
let hexCacheDir: string;
const instantDir = join(config.compilation.buildCacheDir, "binaries");

function fakeCli() {
  return vi.spyOn(cliRunner, "compileWithArduinoCli").mockResolvedValue({
    success: true,
    output: "Sketch uses 932 bytes (2%) of program storage space.\n\nBoard: Arduino UNO",
    binary: HEX,
    elf: ELF,
  });
}

const sketch = () => `// ${randomUUID()}\nvoid setup(){}\nvoid loop(){}\n`;
const compile = async (code: string, options: Record<string, unknown> = {}) =>
  (await ArduinoCompiler.create()).compile(code, undefined, root, { hexCacheDir, ...options });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "unosim-artifact-"));
  hexCacheDir = join(root, "hex-cache");
  vi.spyOn(toolchainInfo, "readToolchainInfo").mockResolvedValue(toolchain);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("ArduinoCompiler artifact and build identity", () => {
  it("returns the artifact of a fresh build for the Uno, with the symbols of the ELF", async () => {
    fakeCli();

    const result = await compile(sketch());

    expect(result.success).toBe(true);
    expect(result.artifact).toMatchObject({ formatVersion: 1, board: "uno", flashBytes: 932 });
    expect(result.artifact?.buildId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.artifact?.symbols.data.__bss_end).toBe(0x109);
  });

  it("builds the artifact for the board named in the options", async () => {
    fakeCli();

    const result = await compile(sketch(), { board: "nano", fqbn: "arduino:avr:nano:cpu=atmega328" });

    expect(result.artifact?.board).toBe("nano");
  });

  it("gives no artifact for a build whose FQBN is not in the catalog", async () => {
    fakeCli();

    const result = await compile(sketch(), { fqbn: "vendor:arch:board" });

    expect(result.success).toBe(true);
    expect(result.artifact).toBeUndefined();
  });

  it("serves a repeated compile from the cache, with the same artifact", async () => {
    const cli = fakeCli();
    const code = sketch();

    const first = await compile(code);
    const second = await compile(code);

    expect(cli).toHaveBeenCalledTimes(1);
    expect(second.artifact).toEqual(first.artifact);
    expect(await readdir(hexCacheDir)).toEqual(expect.arrayContaining([expect.stringMatching(/\.artifact\.json$/)]));
  });

  it.each([
    ["the arduino-cli version", { ...toolchain, arduinoCli: "1.5.2" }],
    ["a core version", { ...toolchain, cores: [{ id: "arduino:avr", version: "1.8.9" }] }],
    ["an installed library", { ...toolchain, librariesFingerprint: "0".repeat(64) }],
  ])("builds again when %s changed since the entry was written", async (_name, changed) => {
    const cli = fakeCli();
    const code = sketch();
    const first = await compile(code);

    vi.spyOn(toolchainInfo, "readToolchainInfo").mockResolvedValue(changed);
    const second = await compile(code);

    expect(cli).toHaveBeenCalledTimes(2);
    expect(second.artifact?.buildId).not.toBe(first.artifact?.buildId);
  });

  // Changed with the project libraries (SSOT Libraries §11, approved 2026-10-28): requests carry
  // resolved packages; a different checksum of the same version is another build.
  it("builds again when the requested libraries differ", async () => {
    const cli = fakeCli();
    const code = sketch();
    const aunit = { name: "AUnit", version: "1.7.1", sha256: "a".repeat(64), dir: "/libs/AUnit-1.7.1/AUnit" };

    await compile(code, { libraries: [] });
    await compile(code, { libraries: [aunit] });
    await compile(code, { libraries: [{ ...aunit, sha256: "b".repeat(64) }] });
    await compile(code, { libraries: [{ ...aunit, sha256: "b".repeat(64), dir: "/elsewhere/AUnit" }] });

    expect(cli).toHaveBeenCalledTimes(3);
  });

  it("builds again for another board option, because the FQBN is part of the key", async () => {
    const cli = fakeCli();
    const code = sketch();

    await compile(code, { fqbn: "arduino:avr:uno" });
    await compile(code, { fqbn: "arduino:avr:nano:cpu=atmega328" });

    expect(cli).toHaveBeenCalledTimes(2);
  });

  /** The sidecar files of one sketch in both cache directories (never other entries of a developer's cache). */
  const sidecarsOf = (code: string) => {
    const name = `${buildSketchHash({ code }, "arduino:avr:uno")}.artifact.json`;
    return [join(hexCacheDir, name), join(instantDir, name)];
  };

  it("builds again when the sidecar is missing, as for entries written before this change", async () => {
    const cli = fakeCli();
    const code = sketch();
    await compile(code);
    for (const sidecar of sidecarsOf(code)) await rm(sidecar, { force: true });

    await compile(code);

    expect(cli).toHaveBeenCalledTimes(2);
  });

  it("builds again when the sidecar is damaged and rewrites it", async () => {
    const cli = fakeCli();
    const code = sketch();
    await compile(code);
    for (const sidecar of sidecarsOf(code)) await writeFile(sidecar, "{ broken");

    const result = await compile(code);

    expect(cli).toHaveBeenCalledTimes(2);
    expect(result.artifact).toBeDefined();
    expect(JSON.parse(await readFile(sidecarsOf(code)[0], "utf8")).identity.fqbn).toBe("arduino:avr:uno");
  });

  it("does not write a sidecar or return an artifact for a failed compile", async () => {
    vi.spyOn(cliRunner, "compileWithArduinoCli").mockResolvedValue({ success: false, output: "", errors: "sketch.ino:1:1: error: boom" });
    await mkdir(hexCacheDir, { recursive: true });

    const result = await compile(sketch());

    expect(result.success).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(await readdir(hexCacheDir)).toEqual([]);
  });
});

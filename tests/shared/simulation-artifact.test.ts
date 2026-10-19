import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSimulationImage, encodeBase64 } from "@unosim/avr-emulator/image";
import { MAX_ARTIFACT_BASE64_CHARS, parseSimulationArtifact, simulationArtifactSchema } from "../../shared/simulation-artifact";

const hex = readFileSync(join(__dirname, "../../packages/avr-emulator/tests/fixtures/uno-blink.hex"), "utf8");
const elf = new Uint8Array(readFileSync(join(__dirname, "../../packages/avr-emulator/tests/fixtures/uno-blink-nolto.elf")));
const BUILD_ID = "ab".repeat(32);
const artifact = (patch: Record<string, unknown> = {}) => ({ ...buildSimulationImage({ board: "uno", hex, elf }), buildId: BUILD_ID, ...patch });

describe("simulation artifact schema (plan E5, P2.5)", () => {
  it("accepts an artifact built by the package, symbols included", () => {
    const parsed = simulationArtifactSchema.safeParse(artifact());

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.symbols.functions.digitalWrite).toBeGreaterThan(0);
    expect(parsed.success && parsed.data.symbols.data.__bss_end).toBe(0x109);
  });

  it("is at most about 43 KB for the Uno and 350 KB for the largest board", () => {
    const uno = artifact();

    expect(uno.flashBase64.length).toBeLessThan(43 * 1024);
    expect(MAX_ARTIFACT_BASE64_CHARS).toBe(Math.ceil((256 * 1024) / 3) * 4);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown board", { board: "esp32" }],
    ["another format version", { formatVersion: 2 }],
    ["a build id that is no SHA-256", { buildId: "abc" }],
    ["a missing build id", { buildId: undefined }],
    ["an upper-case SHA-256", { sha256: "AB".repeat(32) }],
    ["an unknown field", { binary: "x" }],
    ["flash that is not Base64", { flashBase64: "not base64!" }],
    ["a flashBytes value that does not match the Base64 text", { flashBytes: 5 }],
    ["more bytes than the MCU's flash", { flashBytes: 32 * 1024 + 1, flashBase64: encodeBase64(new Uint8Array(32 * 1024 + 1)) }],
    ["an unknown function symbol", { symbols: { functions: { evil: 1 }, data: {} } }],
    ["a symbol address outside the flash", { symbols: { functions: { pinMode: 1 << 20 }, data: {} } }],
    ["a data symbol outside the data space", { symbols: { functions: {}, data: { __bss_end: 0x20000 } } }],
    ["a negative symbol address", { symbols: { functions: {}, data: { _end: -1 } } }],
  ])("rejects %s", (_name, patch) => {
    expect(simulationArtifactSchema.safeParse(artifact(patch)).success).toBe(false);
  });

  it("accepts a larger image on a board with a larger MCU", () => {
    const flash = new Uint8Array(64 * 1024);

    expect(simulationArtifactSchema.safeParse(artifact({ board: "mega2560", flashBytes: flash.length, flashBase64: encodeBase64(flash) })).success).toBe(true);
    expect(simulationArtifactSchema.safeParse(artifact({ board: "uno", flashBytes: flash.length, flashBase64: encodeBase64(flash) })).success).toBe(false);
  });
});

describe("parseSimulationArtifact", () => {
  it("returns the artifact or undefined", () => {
    expect(parseSimulationArtifact(artifact())?.buildId).toBe(BUILD_ID);
    expect(parseSimulationArtifact({ ...artifact(), buildId: "x" })).toBeUndefined();
    expect(parseSimulationArtifact(null)).toBeUndefined();
  });
});

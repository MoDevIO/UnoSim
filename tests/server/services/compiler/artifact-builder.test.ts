import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildArtifact, readBuildRecord, writeBuildRecord } from "../../../../server/services/compiler/artifact-builder";
import { buildIdOf, createBuildIdentity } from "../../../../server/services/compiler/build-identity";

const fixtures = join(__dirname, "../../../../packages/avr-emulator/tests/fixtures");
const hex = readFileSync(join(fixtures, "uno-blink.hex"));
const elf = readFileSync(join(fixtures, "uno-blink-nolto.elf"));
const toolchain = { arduinoCli: "1.5.1", cores: [{ id: "arduino:avr", version: "1.8.8" }], librariesFingerprint: "f".repeat(64) };
const identity = createBuildIdentity({ sketchHash: "a".repeat(64), fqbn: "arduino:avr:uno", toolchain, buildOptions: ["--verbose"] });

describe("buildArtifact (plan P2.5)", () => {
  it("builds the artifact from HEX and ELF with the id of the identity and the symbols", () => {
    const artifact = buildArtifact({ board: "uno", hex, elf, identity });

    expect(artifact).toMatchObject({ formatVersion: 1, board: "uno", buildId: buildIdOf(identity), flashBytes: 932 });
    expect(artifact?.sha256).toBe("08ca27a87a1a5a0ecaf805be862333766f2fba5328f086089d123b4144cf776f");
    expect(artifact?.symbols.data.__bss_end).toBe(0x109);
    expect(artifact?.symbols.functions.digitalWrite).toBeGreaterThan(0);
  });

  it("builds an artifact without symbols when there is no ELF", () => {
    const artifact = buildArtifact({ board: "uno", hex, identity });

    expect(artifact?.symbols).toEqual({ functions: {}, data: {} });
  });

  it("gives no artifact for a HEX without data or text that is no HEX", () => {
    expect(buildArtifact({ board: "uno", hex: Buffer.from(":00000001FF\n"), identity })).toBeUndefined();
    expect(buildArtifact({ board: "uno", hex: Buffer.from("not hex"), identity })).toBeUndefined();
  });

  it("gives no artifact for a flash that does not fit the board", () => {
    const record = (address: number, bytes: number[]) => {
      const body = [bytes.length, (address >> 8) & 0xff, address & 0xff, 0, ...bytes];
      const sum = (0x100 - (body.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
      return `:${[...body, sum].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    };
    const big = Buffer.from([record(0x1ffe, [1, 2, 3, 4]), ":00000001FF", ""].join("\n")); // ends at 0x2002: too big for an ATtiny85 (8 KB)

    expect(buildArtifact({ board: "attiny85", hex: big, identity })).toBeUndefined();
    expect(buildArtifact({ board: "uno", hex: big, identity })).toBeDefined();
  });
});

describe("build record sidecar", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "unosim-record-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const artifact = () => buildArtifact({ board: "uno", hex, elf, identity });

  it("round-trips a record with its artifact", async () => {
    await writeBuildRecord(dir, "key", { identity, artifact: artifact() });

    expect(await readBuildRecord(dir, "key", identity)).toEqual({ identity, artifact: artifact() });
  });

  it("round-trips a record without an artifact", async () => {
    await writeBuildRecord(dir, "key", { identity });

    expect(await readBuildRecord(dir, "key", identity)).toEqual({ identity });
  });

  it("is null without a sidecar", async () => {
    expect(await readBuildRecord(dir, "missing", identity)).toBeNull();
  });

  it.each([
    ["another arduino-cli", { toolchain: { ...toolchain, arduinoCli: "1.5.2" } }],
    ["another core version", { toolchain: { ...toolchain, cores: [{ id: "arduino:avr", version: "1.8.9" }] } }],
    ["another library set", { toolchain: { ...toolchain, librariesFingerprint: "0".repeat(64) } }],
    ["other build options", { buildOptions: ["--verbose", "--warnings=all"] }],
    ["another source", { sketchHash: "b".repeat(64) }],
  ])("is null for a sidecar built under %s", async (_name, patch) => {
    await writeBuildRecord(dir, "key", { identity, artifact: artifact() });
    const current = createBuildIdentity({ sketchHash: "a".repeat(64), fqbn: "arduino:avr:uno", toolchain, buildOptions: ["--verbose"], ...patch });

    expect(await readBuildRecord(dir, "key", current)).toBeNull();
  });

  it("is null for damaged files and for an artifact of another build", async () => {
    await writeFile(join(dir, "broken.artifact.json"), "{ not json");
    await writeFile(join(dir, "wrong.artifact.json"), JSON.stringify({ identity, artifact: { ...artifact(), buildId: "0".repeat(64) } }));
    await writeFile(join(dir, "invalid.artifact.json"), JSON.stringify({ identity, artifact: { board: "uno" } }));

    expect(await readBuildRecord(dir, "broken", identity)).toBeNull();
    expect(await readBuildRecord(dir, "wrong", identity)).toBeNull();
    expect(await readBuildRecord(dir, "invalid", identity)).toBeNull();
  });

  it("leaves no temporary file behind", async () => {
    await writeBuildRecord(dir, "key", { identity });

    expect(JSON.parse(await readFile(join(dir, "key.artifact.json"), "utf8")).identity.fqbn).toBe("arduino:avr:uno");
  });
});

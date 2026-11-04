import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CorpusBuildCache, type CorpusCaseRef } from "../../../scripts/runtime-fixtures";

// A stand-in arduino-cli on the PATH logs when each compile starts and ends; a case named "broken" fails.
const FAKE_CLI = `#!/bin/sh
echo "start $3 $(basename "$6")" >> "$FAKE_CLI_LOG"
sleep 0.2
if [ "$(basename "$6")" = broken ]; then echo "end $3 broken" >> "$FAKE_CLI_LOG"; exit 1; fi
mkdir -p "$5"
echo ":00000001FF" > "$5/$(basename "$6").ino.hex"
echo "end $3 $(basename "$6")" >> "$FAKE_CLI_LOG"
`;

describe("CorpusBuildCache (scripts/runtime-fixtures.ts)", () => {
  const work = mkdtempSync(join(tmpdir(), "unosim-corpus-cache-test-"));
  const log = join(work, "cli.log");
  const originalPath = process.env.PATH;
  let cache: CorpusBuildCache;

  const ref = (id: string, board: string): CorpusCaseRef => {
    const dir = join(work, "cases", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.ino`), "void setup() {}\nvoid loop() {}\n");
    return { dir, id, board };
  };
  const events = () => readFileSync(log, "utf8").trim().split("\n");

  beforeAll(() => {
    mkdirSync(join(work, "bin"));
    writeFileSync(join(work, "bin", "arduino-cli"), FAKE_CLI);
    chmodSync(join(work, "bin", "arduino-cli"), 0o755);
    process.env.PATH = `${join(work, "bin")}:${originalPath}`;
    process.env.FAKE_CLI_LOG = log;
  });

  afterEach(async () => {
    await cache.dispose();
    rmSync(log, { force: true });
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    delete process.env.FAKE_CLI_LOG;
    rmSync(work, { recursive: true, force: true });
  });

  it("builds each core alone before the other compiles of that FQBN, and different FQBNs side by side", async () => {
    cache = new CorpusBuildCache();
    const hexes = await Promise.all([ref("uno1", "uno"), ref("uno2", "uno"), ref("uno3", "uno"), ref("nano1", "nano")].map((item) => cache.compile(item)));

    expect(hexes).toEqual(Array(4).fill(":00000001FF\n"));
    const order = events();
    const at = (event: string) => order.indexOf(event);
    expect(at("end arduino:avr:uno uno1")).toBeLessThan(at("start arduino:avr:uno uno2"));
    expect(at("end arduino:avr:uno uno1")).toBeLessThan(at("start arduino:avr:uno uno3"));
    expect(at("start arduino:avr:nano:cpu=atmega328 nano1")).toBeLessThan(at("end arduino:avr:uno uno1"));
  });

  it("still runs the other compiles of an FQBN when its first compile fails", async () => {
    cache = new CorpusBuildCache();
    const [broken, next] = await Promise.allSettled([cache.compile(ref("broken", "uno")), cache.compile(ref("after", "uno"))]);

    expect(broken.status).toBe("rejected");
    expect(next).toEqual({ status: "fulfilled", value: ":00000001FF\n" });
    expect(events()).toEqual(["start arduino:avr:uno broken", "end arduino:avr:uno broken", "start arduino:avr:uno after", "end arduino:avr:uno after"]);
  });
});

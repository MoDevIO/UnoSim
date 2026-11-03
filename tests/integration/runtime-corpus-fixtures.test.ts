import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CORPUS_ROOT, CorpusBuildCache, hexPath, listCaseDirs, readCaseRef } from "../../scripts/runtime-fixtures";

/**
 * Plan 7.4: the HEX fixtures of the runtime corpus are reproducible. A rebuild
 * with the pinned toolchain must give the checked-in bytes; otherwise the
 * fixtures and the core version are updated together (`npm run fixtures:runtime`).
 *
 * The cases compile concurrently (the project's `maxConcurrency` bounds the arduino-cli processes) and share
 * one build cache per run, so core artifacts can be reused and the user's global cache does not grow.
 */
const cases = listCaseDirs().map(readCaseRef);
const TEST_TIMEOUT_MS = 120_000;
/** Below the test timeout, so a hanging arduino-cli is killed before its test gives up. */
const COMPILE_TIMEOUT_MS = 100_000;

describe("runtime corpus fixtures", () => {
  const cache = new CorpusBuildCache();
  afterAll(() => cache.dispose(), TEST_TIMEOUT_MS);

  it("has a HEX file for every case and a case for every HEX file", () => {
    const expected = cases.map((ref) => `${ref.board}/${ref.id}.hex`).sort();
    const present = readdirSync(join(CORPUS_ROOT, "hex"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((board) => readdirSync(join(CORPUS_ROOT, "hex", board.name)).map((file) => `${board.name}/${file}`))
      .sort();

    expect(present).toEqual(expected);
  });

  it.concurrent.each(cases.map((ref) => [`${basename(join(ref.dir, ".."))}/${ref.id}`, ref] as const))("rebuilds %s to the checked-in HEX", async (_name, ref) => {
    expect(existsSync(hexPath(ref))).toBe(true);

    expect(await cache.compile(ref, COMPILE_TIMEOUT_MS)).toBe(readFileSync(hexPath(ref), "utf8"));
  }, TEST_TIMEOUT_MS);

  it("names the case, the reason and the compiler output of a failed compile, and removes its cache", async () => {
    const root = mkdtempSync(join(tmpdir(), "unosim-corpus-broken-"));
    const own = new CorpusBuildCache();
    try {
      mkdirSync(join(root, "broken"));
      writeFileSync(join(root, "broken", "broken.ino"), "void setup() { undefinedCall(); }\nvoid loop() {}\n");
      const ref = { dir: join(root, "broken"), id: "broken", board: "uno" };

      await expect(own.compile(ref, COMPILE_TIMEOUT_MS)).rejects.toThrow(/^arduino-cli failed for broken \(exit code 1\):\n[\s\S]*undefinedCall/);
      await expect(own.compile(ref, 1)).rejects.toThrow(/^arduino-cli failed for broken \(timed out after 1 ms\)/);
    } finally {
      await own.dispose();
      rmSync(root, { recursive: true, force: true });
    }
    expect(existsSync(own.path)).toBe(false);
  }, TEST_TIMEOUT_MS);
});

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_ROOT, compileCase, hexPath, listCaseDirs, readCaseRef } from "../../scripts/runtime-fixtures";

/**
 * Plan 7.4: the HEX fixtures of the runtime corpus are reproducible. A rebuild
 * with the pinned toolchain must give the checked-in bytes; otherwise the
 * fixtures and the core version are updated together (`npm run fixtures:runtime`).
 */
const cases = listCaseDirs().map(readCaseRef);

describe("runtime corpus fixtures", () => {
  it("has a HEX file for every case and a case for every HEX file", () => {
    const expected = cases.map((ref) => `${ref.board}/${ref.id}.hex`).sort();
    const present = readdirSync(join(CORPUS_ROOT, "hex"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((board) => readdirSync(join(CORPUS_ROOT, "hex", board.name)).map((file) => `${board.name}/${file}`))
      .sort();

    expect(present).toEqual(expected);
  });

  it.concurrent.each(cases.map((ref) => [`${basename(join(ref.dir, ".."))}/${ref.id}`, ref] as const))("rebuilds %s to the checked-in HEX", (_name, ref) => {
    expect(existsSync(hexPath(ref))).toBe(true);

    expect(compileCase(ref)).toBe(readFileSync(hexPath(ref), "utf8"));
  }, 120_000);
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_ROOT, loadCorpus } from "./corpus-helpers";

const MEGA_DIR = join(CORPUS_ROOT, "examples-v3.0.0-mega");
const UNO_DIR = join(CORPUS_ROOT, "examples-v3.0.0");
const isCaseFile = (name: string) => name === "case.json" || /^(expected|recorded)\./.test(name);

/**
 * The extract of the examples that also runs on the Mega 2560 (plan P5.4) holds unchanged copies of the sketches and
 * headers of `examples-v3.0.0`; the expectation per case is the Mega's own.
 */
describe("examples on the Mega 2560 (corpus extract)", () => {
  const ids = readdirSync(MEGA_DIR);

  it("has an extract of the examples", () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ids)("%s: sketch and headers are unchanged copies of the Uno example", (id) => {
    const files = readdirSync(join(MEGA_DIR, id)).filter((name) => !isCaseFile(name));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(MEGA_DIR, id, file), "utf8"), `${id}/${file}`).toBe(readFileSync(join(UNO_DIR, id, file), "utf8"));
    }
    expect(files.sort()).toEqual(readdirSync(join(UNO_DIR, id)).filter((name) => !isCaseFile(name)).sort());
  });

  it("runs every case on the Mega and claims no recording on a Mega", () => {
    const cases = loadCorpus().filter((testCase) => testCase.group === "examples-v3.0.0-mega");

    expect(cases.map((testCase) => testCase.id).sort()).toEqual([...ids].sort());
    for (const testCase of cases) {
      expect(testCase.board, testCase.id).toBe("mega2560");
      expect(testCase.provenance, testCase.id).toBe("derived");
    }
  });
});

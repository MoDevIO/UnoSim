import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS_ROOT, loadCorpus } from "./corpus-helpers";

const UNO_DIR = join(CORPUS_ROOT, "examples-v3.0.0");
const isCaseFile = (name: string) => name === "case.json" || /^(expected|recorded)\./.test(name);

/**
 * The extracts of the examples that also run on the Nano and the Mega 2560 (plans P4.8, P5.4) hold unchanged copies of
 * the sketches and headers of `examples-v3.0.0`; the expectation per case is the board's own.
 */
describe.each([
  { board: "nano", group: "examples-v3.0.0-nano", minimum: 5 },
  { board: "mega2560", group: "examples-v3.0.0-mega", minimum: 10 },
])("examples on the $board (corpus extract)", ({ board, group, minimum }) => {
  const dir = join(CORPUS_ROOT, group);
  const ids = readdirSync(dir);

  it("has an extract of the examples", () => {
    expect(ids.length).toBeGreaterThanOrEqual(minimum);
  });

  it.each(ids)("%s: sketch and headers are unchanged copies of the Uno example", (id) => {
    const files = readdirSync(join(dir, id)).filter((name) => !isCaseFile(name));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(dir, id, file), "utf8"), `${id}/${file}`).toBe(readFileSync(join(UNO_DIR, id, file), "utf8"));
    }
    expect(files.sort()).toEqual(readdirSync(join(UNO_DIR, id)).filter((name) => !isCaseFile(name)).sort());
  });

  it(`runs every case on the ${board} and claims no recording on it`, () => {
    const cases = loadCorpus().filter((testCase) => testCase.group === group);

    expect(cases.map((testCase) => testCase.id).sort()).toEqual([...ids].sort());
    for (const testCase of cases) {
      expect(testCase.board, testCase.id).toBe(board);
      expect(testCase.provenance, testCase.id).toBe("derived");
    }
  });
});

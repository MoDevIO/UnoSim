import { describe, expect, it } from "vitest";
import { diffOutput, loadCorpus, normalizeOutput, parseCaseFile } from "./corpus-helpers";
import { SHARDS } from "./corpus-suite";

const valid = {
  board: "uno",
  simMs: 100,
  provenance: "derived",
  basis: "datasheet",
  toolchain: "arduino-cli 1.5.1, arduino:avr@1.8.8",
  description: "a case",
};
const parse = (patch: Record<string, unknown>) => parseCaseFile({ ...valid, ...patch }, "case", "probes", "/tmp/case");

describe("parseCaseFile", () => {
  it("accepts a complete case and fills the optional lists", () => {
    expect(parse({})).toMatchObject({ board: "uno", simMs: 100, provenance: "derived", events: [], expectState: [], tolerances: [] });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["an unknown board", { board: "esp32" }, /unknown board/],
    ["an unknown class", { provenance: "guess" }, /provenance must be one of/],
    ["a missing basis", { basis: "" }, /"basis"/],
    ["a missing toolchain", { toolchain: undefined }, /"toolchain"/],
    ["a non-positive duration", { simMs: 0 }, /simMs/],
    ["a hardware case without recording", { provenance: "hardware" }, /recordedOn/],
    ["invalid events", { events: [[0, "wiggle"]] }, /unknown kind/],
    ["a tolerance without reason", { tolerances: [{ pattern: String.raw`(\d+)`, plusMinus: 1 }] }, /pattern, plusMinus and reason/],
    ["an invalid tolerance pattern", { tolerances: [{ pattern: "(", plusMinus: 1, reason: "x" }] }, /Invalid regular expression/],
  ])("rejects %s", (_name, patch, message) => {
    expect(() => parse(patch)).toThrow(message);
  });

  it("accepts a hardware case with its recording", () => {
    expect(parse({ provenance: "hardware", recordedOn: "Arduino Uno R3" }).recordedOn).toBe("Arduino Uno R3");
  });

  it("rejects a case file that is not an object", () => {
    expect(() => parseCaseFile([], "case", "probes", "/tmp/case")).toThrow(/must be an object/);
  });
});

describe("diffOutput", () => {
  const tolerance = [{ pattern: String.raw`^took (\d+) ms$`, plusMinus: 1, reason: "granularity" }];

  it("reports every differing line and a different length", () => {
    expect(diffOutput("a\nb\nc\n", "a\nx\nc\n")).toEqual(['line 2: expected "b", got "x"']);
    expect(diffOutput("a\n", "a\nb\n")).toEqual(['line 2: expected "", got "b"', 'line 3: expected undefined, got ""']);
  });

  it("allows the captured number to deviate within the tolerance only", () => {
    expect(diffOutput("took 100 ms\n", "took 101 ms\n", tolerance)).toEqual([]);
    expect(diffOutput("took 100 ms\n", "took 99 ms\n", tolerance)).toEqual([]);
    expect(diffOutput("took 100 ms\n", "took 102 ms\n", tolerance)).toHaveLength(1);
  });

  it("still requires the rest of the line to match", () => {
    expect(diffOutput("took 100 ms\n", "took 100 s\n", tolerance)).toHaveLength(1);
    expect(diffOutput("took 100 ms\n", "other 100 ms\n", tolerance)).toHaveLength(1);
  });

  it("masks the capture group itself, not an earlier equal digit sequence", () => {
    const echo = [{ pattern: String.raw`^delay\(100\): (\d+)$`, plusMinus: 1, reason: "granularity" }];

    expect(diffOutput("delay(100): 100\n", "delay(100): 99\n", echo)).toEqual([]);
  });

  it("tolerates every captured number of a line", () => {
    const both = [{ pattern: String.raw`^from (\d+) to (\d+)$`, plusMinus: 2, reason: "granularity" }];

    expect(diffOutput("from 0 to 587\n", "from 1 to 586\n", both)).toEqual([]);
    expect(diffOutput("from 0 to 587\n", "from 3 to 586\n", both)).toHaveLength(1);
    expect(diffOutput("from 0 to 587\n", "from 1 to 590\n", both)).toHaveLength(1);
  });

  it("does not apply a tolerance to lines it does not match", () => {
    expect(diffOutput("count 5\n", "count 6\n", tolerance)).toHaveLength(1);
  });
});

describe("normalizeOutput and loadCorpus", () => {
  it("turns CRLF into LF", () => {
    expect(normalizeOutput("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("assigns every case to exactly one test shard", () => {
    const shards = Object.values(SHARDS);

    for (const testCase of loadCorpus()) {
      expect(shards.filter((belongs) => belongs(testCase)).length, `${testCase.group}/${testCase.id}`).toBe(1);
    }
  });

  it("loads the checked-in corpus with unique ids per group", () => {
    const corpus = loadCorpus();
    const keys = corpus.map((testCase) => `${testCase.group}/${testCase.id}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(corpus.every((testCase) => testCase.provenance !== "hardware" || testCase.recordedOn)).toBe(true);
  });
});

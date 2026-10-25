import { describe, expect, it } from "vitest";
import { stripComments } from "@shared/parser-patterns";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";

/**
 * The array facts were found with `[^\]]*` and `[^}]*` that rescan the rest of the text for every start:
 * 128 KiB of "int a[" took 1.3 s and of "int a[]={" 0.9 s, on the request of the Tutor. They are linear now and
 * give the facts the unbounded patterns gave for every ordinary sketch.
 */
const extractor = new DefaultSketchFactExtractor();

/** The array facts as the unbounded patterns found them. */
function referenceArrays(code: string) {
  const clean = stripComments(code);
  const result: Array<{ name: string; elementType: string; elementCount: number }> = [];
  for (const match of clean.matchAll(/\b(char|byte|uint8_t|int|long|float)\s+([A-Za-z_]\w*)\s*\[([^\]]*)\]/g)) {
    const initializer = /^\s*=\s*\{([^}]*)\}/.exec(clean.slice((match.index ?? 0) + match[0].length))?.[1]?.trim();
    const declared = Number.parseInt(match[3]?.trim() ?? "", 10);
    let elementCount = 0;
    if (initializer) elementCount = initializer.split(",").map((item) => item.trim()).filter(Boolean).length;
    else if (Number.isSafeInteger(declared) && declared > 0) elementCount = declared;
    result.push({ name: match[2]!, elementType: match[1] === "uint8_t" ? "byte" : match[1]!, elementCount });
  }
  return result;
}

describe("sketch facts: arrays", () => {
  it("find the arrays of ordinary sketches as before", () => {
    const sketch = [
      "int values[] = {1, 2, 3};",
      "byte table[8];",
      "char name[ 16 ] = { 'a', 'b' };",
      "float f[2] =\n  {0.5,\n 1.5};",
      "long unsorted[N * 2];",
      "int empty[] = {};",
      "/* int hidden[4]; */ int shown[5];",
    ].join("\n");

    expect(extractor.extract(sketch).arrays).toEqual(referenceArrays(sketch));
    expect(extractor.extract(sketch).arrays.map((array) => array.elementCount)).toEqual([3, 8, 2, 2, 0, 0, 5]);
  });

  it("agree with the unbounded patterns on random texts of the characters that make arrays", () => {
    const alphabet = ["int ", "byte ", "a", "b", "[", "]", "3", " ", "=", "{", "}", ",", ";", "\n", "/*", "*/"];
    let seed = 987;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let round = 0; round < 3000; round++) {
      const code = Array.from({ length: 1 + (next() % 30) }, () => alphabet[next() % alphabet.length]).join("");

      expect(extractor.extract(code).arrays, JSON.stringify(code)).toEqual(referenceArrays(code));
    }
  });

  it.each([
    ["an array declaration without its closing bracket, repeated", "int a[".repeat(21_000)],
    ["an initializer without its closing brace, repeated", "int a[]={".repeat(14_000)],
    ["initializers with one closing brace at the end", "int a[]={".repeat(14_000) + "}"],
    ["many ordinary arrays", "int a[1]={1,2};\n".repeat(8_000)],
  ])("takes no noticeable time for %s (128 KiB)", (_label, code) => {
    const started = performance.now();
    extractor.extract(code);

    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe("the Tutor request with a pathological sketch", () => {
  it("does not hold the server: a sketch of 120 KB made of unterminated comment openers is analysed at once", async () => {
    const { TutorService } = await import("../../../../server/services/tutor/tutor-service");
    const { vi } = await import("vitest");
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Was passiert hier?" } }),
    };
    const started = performance.now();

    await new TutorService(provider).generateQuestion("/*a".repeat(40_000), "key", undefined, 30);

    expect(performance.now() - started).toBeLessThan(500);
    expect(provider.generateLearningQuestion).toHaveBeenCalledOnce();
  });
});

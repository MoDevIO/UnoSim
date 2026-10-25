import { describe, expect, it } from "vitest";
import { stripComments } from "../../shared/parser-patterns";
import { analyzeStaticIO } from "../../shared/io-registry-parser";

/**
 * The comment regex rescanned the rest of the text for every opener of an unterminated comment: 48 KB of
 * "/*a" took 1.7 s, 96 KB 6.6 s, blocking the server. The scan is linear and gives the same text.
 */
const referenceStrip = (code: string): string =>
  code
    .replaceAll(/\/\*[^*]*(?:\*+[^*/][^*]*)*\*\//g, (match) => match.replaceAll(/[^\n]/g, " "))
    .replaceAll(/\/\/[^\n]*$/gm, (match) => " ".repeat(match.length));

describe("stripComments", () => {
  it("gives the text the comment regex gave, on random texts of the characters that make comments", () => {
    const alphabet = ["/", "*", "a", "\n", " ", "//", "/*", "*/"];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let round = 0; round < 3000; round++) {
      const length = 1 + (next() % 24);
      const code = Array.from({ length }, () => alphabet[next() % alphabet.length]).join("");

      expect(stripComments(code), JSON.stringify(code)).toBe(referenceStrip(code));
    }
  });

  it("blanks comments, keeps newlines and leaves an unterminated comment alone", () => {
    expect(stripComments("a /* x\ny */ b")).toBe("a     \n     b");
    expect(stripComments("a /* never closed\nb")).toBe("a /* never closed\nb");
    expect(stripComments("x /* one */ y /* two */ z // end")).toBe(`x ${" ".repeat(9)} y ${" ".repeat(9)} z ${" ".repeat(6)}`);
  });

  it.each([
    ["an unterminated opener followed by text, repeated", "/*a".repeat(40_000)],
    ["openers only", "/*".repeat(60_000)],
    ["star runs after an opener", "/*" + "*a".repeat(60_000)],
    ["an opener and a long star run", "/*" + "*".repeat(120_000)],
    ["a comment with many stars before its end", "/*" + "**a".repeat(40_000) + "*/"],
  ])("takes no noticeable time for %s (up to the 128 KiB a request may carry)", (_label, code) => {
    const started = performance.now();
    stripComments(code);
    analyzeStaticIO(code);

    expect(performance.now() - started).toBeLessThan(250);
  });
});

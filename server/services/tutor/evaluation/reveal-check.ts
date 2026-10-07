/**
 * Declared literal leaks (`expected.mustNotReveal`, SSOT R-REV-1..3).
 * A miss means only "no declared literal leak", never "no solution revealed".
 */

const MIN_LITERAL_LENGTH = 3;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[`*]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replaceAll(/ ?([^\p{L}\p{N}_ ]) ?/gu, "$1");
}

/** A literal is specific enough when it has at least three characters and one letter after normalization. */
export function isValidRevealLiteral(literal: string): boolean {
  const normalized = normalize(literal);
  return normalized.length >= MIN_LITERAL_LENGTH && /\p{L}/u.test(normalized);
}

export function normalizeRevealLiteral(literal: string): string {
  return normalize(literal);
}

function containsLiteral(text: string, literal: string): boolean {
  let from = text.indexOf(literal);
  while (from !== -1) {
    const before = text[from - 1];
    const after = text[from + literal.length];
    if ((before === undefined || !WORD_CHARACTER.test(before)) && (after === undefined || !WORD_CHARACTER.test(after))) {
      return true;
    }
    from = text.indexOf(literal, from + 1);
  }
  return false;
}

/** Returns the first declared literal that occurs in one of the texts. Texts are never joined. */
export function findRevealedLiteral(texts: readonly string[], literals: readonly string[]): string | undefined {
  const normalizedTexts = texts.map(normalize);
  return literals.find((literal) => {
    const normalizedLiteral = normalize(literal);
    return normalizedLiteral.length > 0 && normalizedTexts.some((text) => containsLiteral(text, normalizedLiteral));
  });
}

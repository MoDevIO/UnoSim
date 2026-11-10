/**
 * A small C++ lexer for "Format Code" (ssot/ssot_function_definition_CodeFormatting.md 3.3). It does not parse:
 * it only separates code from text that is not program structure (strings, character literals, raw strings,
 * comments, preprocessor lines), so that braces, semicolons and keywords inside them never count. Every input
 * character belongs to exactly one token, and the scan is linear in the input length.
 */

export type CppTokenKind =
  | "space" // spaces and tabs
  | "newline"
  | "splice" // a backslash at the end of a code line: the next line continues it
  | "lineComment"
  | "blockComment"
  | "preprocessor" // a directive, with its continuation lines
  | "string"
  | "char"
  | "rawString"
  | "number"
  | "word"
  | "punct";

export interface CppToken {
  readonly kind: CppTokenKind;
  readonly text: string;
}

const RAW_STRING_PREFIXES = new Set(["R", "LR", "uR", "UR", "u8R"]);
const LITERAL_PREFIXES = new Set(["L", "u", "U", "u8"]);
const MAX_RAW_DELIMITER = 16;

function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return /[\w$]/.test(char) || char.codePointAt(0)! > 127;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/** Index after a backslash-newline splice that starts at `index`, or -1: `\`, optional blanks, newline. */
function spliceEnd(source: string, index: number): number {
  if (source[index] !== "\\") return -1;
  let next = index + 1;
  while (source[next] === " " || source[next] === "\t") next++;
  return source[next] === "\n" ? next + 1 : -1;
}

/** End of a quoted literal starting at `index` (a quote): escapes and splices count, a plain newline ends it. */
function quotedEnd(source: string, index: number): number {
  const quote = source[index];
  let next = index + 1;
  while (next < source.length) {
    const char = source[next];
    if (char === "\\") next += 2;
    else if (char === quote) return next + 1;
    else if (char === "\n") return next;
    else next++;
  }
  return source.length;
}

/** End of a raw string whose quote is at `quote`, or -1 when no valid `delimiter(` follows the quote. */
function rawStringEnd(source: string, quote: number): number {
  let open = quote + 1;
  while (open < source.length && open - quote - 1 <= MAX_RAW_DELIMITER && !/[()\\\s"]/.test(source[open]!)) open++;
  if (source[open] !== "(" || open - quote - 1 > MAX_RAW_DELIMITER) return -1;
  const close = `)${source.slice(quote + 1, open)}"`;
  const found = source.indexOf(close, open + 1);
  return found < 0 ? source.length : found + close.length;
}

function blockCommentEnd(source: string, index: number): number {
  const found = source.indexOf("*/", index + 2);
  return found < 0 ? source.length : found + 2;
}

/** End of a line comment: the first newline that no backslash splices. */
function lineCommentEnd(source: string, index: number): number {
  let next = index;
  while (next < source.length && source[next] !== "\n") {
    const spliced = spliceEnd(source, next);
    next = spliced < 0 ? next + 1 : spliced;
  }
  return next;
}

/** End of a preprocessor directive: its continuation lines, and comments and literals that span lines. */
function directiveEnd(source: string, index: number): number {
  let next = index + 1;
  while (next < source.length && source[next] !== "\n") {
    const char = source[next];
    const spliced = spliceEnd(source, next);
    if (spliced >= 0) next = spliced;
    else if (char === "/" && source[next + 1] === "*") next = blockCommentEnd(source, next);
    else if (char === "/" && source[next + 1] === "/") next = lineCommentEnd(source, next);
    else if (char === '"' || char === "'") next = quotedEnd(source, next);
    else next++;
  }
  return next;
}

function numberEnd(source: string, index: number): number {
  let next = index;
  for (;;) {
    const char = source[next];
    const separator = char === "'" && isWordChar(source[next + 1]);
    const exponentSign = (char === "+" || char === "-") && /[eEpP]/.test(source[next - 1] ?? "");
    if (!(isWordChar(char) || char === "." || separator || exponentSign)) return next;
    next++;
  }
}

/** A word, or a literal with a prefix (`L"…"`, `u8'…'`, `R"x(…)x"`). */
function wordOrPrefixedLiteral(source: string, index: number): [CppTokenKind, number] {
  let end = index;
  while (isWordChar(source[end])) end++;
  const word = source.slice(index, end);
  const after = source[end];
  if (after === '"' && RAW_STRING_PREFIXES.has(word)) {
    const raw = rawStringEnd(source, end);
    if (raw >= 0) return ["rawString", raw];
  }
  if ((after === '"' || after === "'") && (LITERAL_PREFIXES.has(word) || RAW_STRING_PREFIXES.has(word))) {
    return [after === '"' ? "string" : "char", quotedEnd(source, end)];
  }
  return ["word", end];
}

function blankEnd(source: string, index: number): number {
  let next = index;
  while (source[next] === " " || source[next] === "\t" || source[next] === "\f" || source[next] === "\v") next++;
  return next;
}

/** Text that is not program structure at `index`: a directive, a comment or an unprefixed literal; else null. */
function scanText(source: string, index: number, lineStart: boolean): [CppTokenKind, number] | null {
  const char = source[index];
  const next = source[index + 1];
  if (char === "#" && lineStart) return ["preprocessor", directiveEnd(source, index)];
  if (char === "/" && next === "/") return ["lineComment", lineCommentEnd(source, index)];
  if (char === "/" && next === "*") return ["blockComment", blockCommentEnd(source, index)];
  if (char === '"') return ["string", quotedEnd(source, index)];
  if (char === "'") return ["char", quotedEnd(source, index)];
  return null;
}

/** The token at `index` (never empty). `lineStart`: only blanks precede it on its line. */
function scan(source: string, index: number, lineStart: boolean): [CppTokenKind, number] {
  const char = source[index]!;
  const next = source[index + 1];
  if (char === "\n") return ["newline", index + 1];
  const blank = blankEnd(source, index);
  if (blank > index) return ["space", blank];
  const text = scanText(source, index, lineStart);
  if (text) return text;
  const spliced = spliceEnd(source, index);
  if (spliced >= 0) return ["splice", spliced];
  if (isDigit(char) || (char === "." && isDigit(next))) return ["number", numberEnd(source, index)];
  if (isWordChar(char)) return wordOrPrefixedLiteral(source, index);
  if (char === ":" && next === ":") return ["punct", index + 2];
  return ["punct", index + 1];
}

/** Splits `source` (line endings already `\n`) into tokens whose texts concatenate to `source`. */
export function tokenizeCpp(source: string): CppToken[] {
  const tokens: CppToken[] = [];
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const [kind, end] = scan(source, index, lineStart);
    tokens.push({ kind, text: source.slice(index, end) });
    if (kind === "newline") lineStart = true;
    else if (kind !== "space") lineStart = false;
    index = end;
  }
  return tokens;
}

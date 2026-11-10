/**
 * A small C++ lexer for "Format Code" (ssot/ssot_function_definition_CodeFormatting.md 3.3). It does not parse:
 * it only separates code from text that is not program structure (strings, character literals, raw strings,
 * comments, preprocessor directives), so that braces, semicolons and keywords inside them never count.
 *
 * It reads the source as the compiler does (translation phases 1–4): a backslash before a line end splices two
 * physical lines into one logical line before anything else is recognized, so `/\` + newline + `/` starts a
 * comment and a backslash-newline inside a string continues it. A comment counts as a blank, so `#` after a comment
 * at the start of a line still begins a directive. Raw strings take back the splices inside them and are read on
 * the physical text. Each token carries its exact physical text, splices included: the tokens concatenate to the
 * input, and the scan is linear in its length.
 */

export type CppTokenKind =
  | "space" // blanks (a splice inside a line belongs to the token before it)
  | "newline" // a physical line end that ends a logical line
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
/** Characters a raw-string delimiter may not contain ([lex.string]). */
const RAW_DELIMITER_EXCLUDED = new Set(["(", ")", "\\", " ", "\t", "\v", "\f", "\n"]);

function isWordChar(char: string | undefined): boolean {
  if (char === undefined) return false;
  return /[\w$]/.test(char) || char.codePointAt(0)! > 127;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\f" || char === "\v";
}

/** Index after a splice (backslash, optional blanks as GCC and Clang accept them, newline) at `index`, or -1. */
function spliceEnd(source: string, index: number): number {
  if (source[index] !== "\\") return -1;
  let next = index + 1;
  while (source[next] === " " || source[next] === "\t") next++;
  return source[next] === "\n" ? next + 1 : -1;
}

/** The source after phase 2, with the physical index of every logical character and back. */
class SplicedText {
  readonly logical: string;
  /** physicalAt[k]: physical index of logical character k; physicalAt[length] is the physical length. */
  readonly physicalAt: Int32Array;
  /** logicalAt[p]: the first logical character at or after physical index p. */
  readonly logicalAt: Int32Array;

  constructor(readonly physical: string) {
    const chars: string[] = [];
    const positions: number[] = [];
    for (let index = 0; index < physical.length;) {
      const spliced = spliceEnd(physical, index);
      if (spliced >= 0) {
        index = spliced;
      } else {
        chars.push(physical[index]!);
        positions.push(index);
        index++;
      }
    }
    positions.push(physical.length);
    this.logical = chars.join("");
    this.physicalAt = Int32Array.from(positions);
    this.logicalAt = new Int32Array(physical.length + 1);
    let logicalIndex = 0;
    for (let index = 0; index <= physical.length; index++) {
      while (this.physicalAt[logicalIndex]! < index) logicalIndex++;
      this.logicalAt[index] = logicalIndex;
    }
  }
}

/** Scans one token at a time on the logical text; every function returns a logical end index. */
class Lexer {
  private readonly source: string;

  constructor(private readonly text: SplicedText) {
    this.source = text.logical;
  }

  /** End of a quoted literal starting at `index` (a quote): escapes count, a line end ends it. */
  private quotedEnd(index: number): number {
    const source = this.source;
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

  /** End of a raw string whose quote is at logical `quote`, or -1 without a valid `delimiter(`. Physical scan. */
  private rawStringEnd(quote: number): number {
    const { physical, physicalAt, logicalAt } = this.text;
    const start = physicalAt[quote]! + 1;
    let open = start;
    while (open < physical.length && open - start <= MAX_RAW_DELIMITER && !RAW_DELIMITER_EXCLUDED.has(physical[open]!)) open++;
    if (physical[open] !== "(" || open - start > MAX_RAW_DELIMITER) return -1;
    const close = `)${physical.slice(start, open)}"`;
    const found = physical.indexOf(close, open + 1);
    return logicalAt[found < 0 ? physical.length : found + close.length]!;
  }

  private blockCommentEnd(index: number): number {
    const found = this.source.indexOf("*/", index + 2);
    return found < 0 ? this.source.length : found + 2;
  }

  private lineEnd(index: number): number {
    const found = this.source.indexOf("\n", index);
    return found < 0 ? this.source.length : found;
  }

  /** End of a directive: its logical line, with comments and literals that span physical lines. */
  private directiveEnd(index: number): number {
    const source = this.source;
    let next = index + 1;
    while (next < source.length && source[next] !== "\n") {
      const char = source[next];
      if (char === "/" && source[next + 1] === "*") next = this.blockCommentEnd(next);
      else if (char === "/" && source[next + 1] === "/") next = this.lineEnd(next);
      else if (char === '"' || char === "'") next = this.quotedEnd(next);
      else if (isWordChar(char) && !isWordChar(source[next - 1])) next = this.wordOrPrefixedLiteral(next)[1];
      else next++;
    }
    return next;
  }

  private numberEnd(index: number): number {
    const source = this.source;
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
  private wordOrPrefixedLiteral(index: number): [CppTokenKind, number] {
    const source = this.source;
    let end = index;
    while (isWordChar(source[end])) end++;
    const word = source.slice(index, end);
    const after = source[end];
    if (after === '"' && RAW_STRING_PREFIXES.has(word)) {
      const raw = this.rawStringEnd(end);
      if (raw >= 0) return ["rawString", raw];
    }
    if ((after === '"' || after === "'") && (LITERAL_PREFIXES.has(word) || RAW_STRING_PREFIXES.has(word))) {
      return [after === '"' ? "string" : "char", this.quotedEnd(end)];
    }
    return ["word", end];
  }

  /** Text that is not program structure at `index`: a directive, a comment or an unprefixed literal; else null. */
  private scanText(index: number, lineStart: boolean): [CppTokenKind, number] | null {
    const char = this.source[index];
    const next = this.source[index + 1];
    if (char === "#" && lineStart) return ["preprocessor", this.directiveEnd(index)];
    if (char === "/" && next === "/") return ["lineComment", this.lineEnd(index)];
    if (char === "/" && next === "*") return ["blockComment", this.blockCommentEnd(index)];
    if (char === '"') return ["string", this.quotedEnd(index)];
    if (char === "'") return ["char", this.quotedEnd(index)];
    return null;
  }

  /** The token at logical `index` (never empty). `lineStart`: only blanks and comments precede it on its line. */
  scan(index: number, lineStart: boolean): [CppTokenKind, number] {
    const source = this.source;
    const char = source[index]!;
    const next = source[index + 1];
    if (char === "\n") return ["newline", index + 1];
    if (isBlank(char)) {
      let end = index;
      while (isBlank(source[end])) end++;
      return ["space", end];
    }
    const text = this.scanText(index, lineStart);
    if (text) return text;
    if (isDigit(char) || (char === "." && isDigit(next))) return ["number", this.numberEnd(index)];
    if (isWordChar(char)) return this.wordOrPrefixedLiteral(index);
    if (char === ":" && next === ":") return ["punct", index + 2];
    return ["punct", index + 1];
  }
}

/** Splits `source` (line endings already `\n`) into tokens whose texts concatenate to `source`. */
export function tokenizeCpp(source: string): CppToken[] {
  const text = new SplicedText(source);
  const lexer = new Lexer(text);
  const tokens: CppToken[] = [];
  let index = 0;
  let physicalStart = 0;
  let lineStart = true;
  while (index < text.logical.length) {
    const [kind, end] = lexer.scan(index, lineStart);
    const physicalEnd = end >= text.logical.length ? source.length : text.physicalAt[end]!;
    tokens.push({ kind, text: source.slice(physicalStart, physicalEnd) });
    // A comment is a blank before a directive (phase 3); a line comment runs to the line end anyway.
    if (kind === "newline") lineStart = true;
    else if (kind !== "space" && kind !== "blockComment") lineStart = false;
    index = end;
    physicalStart = physicalEnd;
  }
  if (physicalStart < source.length) tokens.push({ kind: "space", text: source.slice(physicalStart) });
  return tokens;
}

/**
 * Parser Patterns and Helper Functions
 * 
 * Centralized patterns and utilities shared across all parser modules.
 * Extracted to avoid duplication and ensure consistency.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Common Regex Patterns
// ─────────────────────────────────────────────────────────────────────────────
/** Two separate for-loop regexes to avoid super-linear backtracking (S5843). */
// Groups: 1=type/empty, 2=var, 3=start, 4=op, 5=limit
export const FOR_LOOP_TYPED = /\bfor\s*\(\s*(\w+)\s+(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*([<>]=?)\s*(\w+)\s*;[^)]*\)/g;
export const FOR_LOOP_BARE = /\bfor\s*\(\s*()(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*([<>]=?)\s*(\w+)\s*;[^)]*\)/g;

/** Two separate function-def regexes to reduce alternation complexity (S5843). */
export const FUNCTION_DEF_BASIC = /(?:void|int|bool|byte|long|float|double|char|String)\s+(\w+)\s*\([^)]*\)\s*\{/g;
export const FUNCTION_DEF_UNSIGNED = /unsigned\s+(?:int|long)\s+(\w+)\s*\([^)]*\)\s*\{/g;

/** Serial configuration patterns. */
export const SERIAL_PATTERNS = {
  USAGE: /Serial\s*\.\s*(print|println|write|read|available|peek|readString|readBytes|parseInt|parseFloat|find|findUntil)/,
  BEGIN: /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/,
  BEGIN_EXTRACT: /Serial\s*\.\s*begin\s*\(\s*(\d+)\s*\)/,
  WHILE_NOT: /while\s*\(\s*!\s*Serial\s*\)/,
  READ: /Serial\s*\.\s*read\s*\(\s*\)/,
  AVAILABLE: /Serial\s*\.\s*available\s*\(\s*\)/,
} as const;

/** Structure patterns. */
export const STRUCTURE_PATTERNS = {
  SETUP_FUNCTION: /void\s+setup\s*\(\s*\)/,
  SETUP_ANY: /void\s+setup\s*\([^)]*\)/,
  LOOP_FUNCTION: /void\s+loop\s*\(\s*\)/,
  LOOP_ANY: /void\s+loop\s*\([^)]*\)/,
} as const;

/** Performance patterns. */
export const PERFORMANCE_PATTERNS = {
  WHILE_TRUE: /while\s*\(\s*true\s*\)/,
  FOR_NO_EXIT: /for *\( *[^;\n]+; *; *[^)\n]+\)/, // NOSONAR S5843
  LARGE_ARRAY: /\[\s*(\d{4,})\s*\]/,
} as const;

/** Comment patterns. */
export const COMMENT_PATTERNS = {
  SINGLE_LINE: /\/\/[^\n]*$/gm, // NOSONAR S5843
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces every terminated block comment by spaces and keeps its newlines. An unterminated comment stays
 * as it is.
 *
 * A scan with `indexOf`, not a regular expression: with the usual comment regex every comment opener of an
 * unterminated comment scans to the end of the text again, and a sketch of 48 KB made of the three
 * characters slash, star, a held the server for 1.7 s (96 KB: 6.6 s; a request may carry 128 KiB). If no
 * closer follows one opener, none follows a later one either, so the scan ends there.
 */
function blankBlockComments(code: string): string {
  let result = "";
  let from = 0;
  for (;;) {
    const open = code.indexOf("/*", from);
    if (open < 0) break;
    const close = code.indexOf("*/", open + 2);
    if (close < 0) break;
    result += code.slice(from, open) + code.slice(open, close + 2).replaceAll(/[^\n]/g, " ");
    from = close + 2;
  }
  return result + code.slice(from);
}

/**
 * Strip comments while preserving character positions (newlines kept intact).
 * This allows line numbers in the stripped code to match the original source.
 */
/** The baud rate of an active `Serial.begin(<number>)` in the sketch, if it is a literal. */
export function sketchSerialBaud(code: string): number | undefined {
  const match = SERIAL_PATTERNS.BEGIN_EXTRACT.exec(stripComments(code));
  return match ? Number(match[1]) : undefined;
}

export function stripComments(code: string): string {
  // Multi-line comments → spaces (preserve newlines for correct line counting)
  let result = blankBlockComments(code);
  // Single-line comments → spaces (preserve line length)
  result = result.replaceAll(COMMENT_PATTERNS.SINGLE_LINE, (m) => " ".repeat(m.length));
  return result;
}

const IDENTIFIER_CHAR = /[\w.]/;
const RAW_STRING_PREFIX = /^(?:u8|u|U|L)?R$/;

/** Start of the token that ends right before `pos` (identifier or number characters). */
function tokenStart(code: string, pos: number): number {
  let start = pos;
  while (start > 0 && IDENTIFIER_CHAR.test(code[start - 1])) start--;
  return start;
}

/** End (exclusive) of a quoted literal opened at `open`; an unterminated one ends at the line break. */
function quotedLiteralEnd(code: string, open: number): number {
  const quote = code[open];
  for (let i = open + 1; i < code.length; i++) {
    if (code[i] === "\\") i++;
    else if (code[i] === quote) return i + 1;
    else if (code[i] === "\n") return i;
  }
  return code.length;
}

/** End (exclusive) of a raw string `R"delim( … )delim"` whose quote is at `quote`, or undefined if it is none. */
function rawStringEnd(code: string, quote: number): number | undefined {
  const open = code.indexOf("(", quote + 1);
  const delimiter = open < 0 ? "" : code.slice(quote + 1, open);
  if (open < 0 || delimiter.length > 16 || /[\s\\)]/.test(delimiter)) return undefined;
  const close = code.indexOf(")" + delimiter + '"', open + 1);
  return close < 0 ? code.length : close + delimiter.length + 2;
}

/**
 * The span [start, end) of the comment or literal at `i`, or undefined if none starts there. An unterminated
 * block comment stays text, as in `stripComments`; once no closer follows, none follows a later opener either.
 */
function commentOrLiteralAt(code: string, i: number, scan: { blockCloser: boolean }): [number, number] | undefined {
  const char = code[i];
  if (char === "/" && code[i + 1] === "/") {
    const end = code.indexOf("\n", i);
    return [i, end < 0 ? code.length : end];
  }
  if (char === "/" && code[i + 1] === "*" && scan.blockCloser) {
    const close = code.indexOf("*/", i + 2);
    scan.blockCloser = close >= 0;
    return close < 0 ? undefined : [i, close + 2];
  }
  if (char === '"') {
    const prefix = tokenStart(code, i);
    const rawEnd = RAW_STRING_PREFIX.test(code.slice(prefix, i)) ? rawStringEnd(code, i) : undefined;
    return rawEnd === undefined ? [i, quotedLiteralEnd(code, i)] : [prefix, rawEnd];
  }
  // A quote after a number is a digit separator (1'000), not a character literal.
  if (char === "'" && !/^\d/.test(code.slice(tokenStart(code, i), i))) return [i, quotedLiteralEnd(code, i)];
  return undefined;
}

/**
 * Blanks comments and string, character and raw-string literals with spaces,
 * keeping every newline, so positions and line numbers stay those of the source.
 */
export function blankCommentsAndLiterals(code: string): string {
  let result = "";
  let from = 0;
  let i = 0;
  const scan = { blockCloser: true };
  while (i < code.length) {
    const span = commentOrLiteralAt(code, i, scan);
    if (span) {
      result += code.slice(from, span[0]) + code.slice(span[0], span[1]).replaceAll(/[^\n]/g, " ");
      from = i = span[1];
    } else {
      i++;
    }
  }
  return result + code.slice(from);
}

/**
 * Find line number for a pattern in code.
 * @param code - Full source code
 * @param pattern - Regex pattern to find
 * @returns 1-based line number, or undefined if not found
 */
export function findLineNumber(code: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(code);
  if (!match) return undefined;
  const upToMatch = code.slice(0, Math.max(0, match.index));
  return upToMatch.split("\n").length;
}

/**
 * 1-based line number for a character position in a string.
 */
export function lineAt(code: string, pos: number): number {
  return code.slice(0, pos).split("\n").length;
}

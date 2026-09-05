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

/** Pin-related patterns. */
export const PIN_PATTERNS = {
  MODE: /pinMode\s*\(\s*(\d+|A\d+)\s*,/g,
  MODE_WITH_MODE: /pinMode\s*\(\s*(\d+|A\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g,
  MODE_VAR: /pinMode\s*\(\s*([a-zA-Z_]\w*)\s*,/g,
  ANALOG_WRITE: /analogWrite\s*\(\s*(\d+|A\d+)\s*,/g,
  DIGITAL_READ_WRITE: /digital(?:Read|Write)\s*\(\s*(\d+|A\d+|[a-zA-Z_]\w*)/g,
  DIGITAL_READ_LITERAL: /\bdigitalRead\s*\(\s*(\d+|A\d+)\s*\)/g,
  WRITE_READ_PIN: /pinMode\s*\(\s*(\d+|A\d+)/gi,
  WRITE_READ_DIO: /digital(?:Write|Read)\s*\(\s*(\d+|A\d+)/gi,
  ANALOG_READ_WRITE: /analog(?:Read|Write)\s*\(\s*(\d+|A\d+)/gi,
  MODE_ANY: /pinMode *\( *[^,)\n]+,/, // NOSONAR S5843
  DYNAMIC_PIN_READ: /digitalRead\s*\(\s*[^0-9A\s][^,)]*/,
  DYNAMIC_PIN_WRITE: /digitalWrite\s*\(\s*[^0-9A\s][^,)]*/,
  ANALOG_PIN_FORMAT: /^A\d+$/,
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
  MULTI_LINE: /\/\*[^*]*(?:\*+[^*/][^*]*)*\*\//g,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip comments while preserving character positions (newlines kept intact).
 * This allows line numbers in the stripped code to match the original source.
 */
export function stripComments(code: string): string {
  // Multi-line comments → spaces (preserve newlines for correct line counting)
  let result = code.replaceAll(COMMENT_PATTERNS.MULTI_LINE, (m) =>
    m.replaceAll(/[^\n]/g, " "),
  );
  // Single-line comments → spaces (preserve line length)
  result = result.replaceAll(COMMENT_PATTERNS.SINGLE_LINE, (m) => " ".repeat(m.length));
  return result;
}

/**
 * Remove comments (alias for stripComments for backward compatibility).
 */
export function removeComments(code: string): string {
  return stripComments(code);
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

/**
 * Parse pin number from string (handles literals and A0-A5).
 */
export function parsePinNumber(pinStr: string): number | undefined {
  if (/^\d+$/.test(pinStr)) {
    return Number.parseInt(pinStr, 10);
  }
  if (/^A\d+$/.test(pinStr)) {
    return 14 + Number.parseInt(pinStr.slice(1), 10);
  }
  return undefined;
}

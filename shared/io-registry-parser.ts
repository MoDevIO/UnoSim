/**
 * io-registry-parser.ts
 *
 * Pure static parser for the Hybrid IO-Registry.
 * Analyses Arduino/C++ source code and returns IOPinRecord[] for the
 * 20 known hardware pins (0-13 digital, 14-19 = A0-A5 analog).
 *
 * Covers all 11 SSOT test cases:
 *   TC1  – literal pin + literal mode
 *   TC2  – A0-A5 alias resolution
 *   TC3  – for-loop expansion (variable range)
 *   TC4  – const int / variable resolution
 *   TC5  – #define resolution
 *   TC6  – static entry is created once (no per-call duplication)
 *   TC7  – same pin used in read AND write → both columns filled
 *   TC8  – dynamic pin (runtime() etc.) → NOT included (runtime only)
 *   TC9  – conflict: INPUT/INPUT_PULLUP mode + digitalWrite → warning
 *   TC10 – array index resolution (pins[1])
 *   TC11 – multiple different pinMode modes → warning + both lines
 */

import type { IOPinRecord } from "./schema";
import type { PinMode } from "@shared/types/arduino.types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Regex Patterns
// ─────────────────────────────────────────────────────────────────────────────

/** Built-in Arduino pin-name constants mapped to numeric IDs (0-19). */
const BUILTIN_CONSTANTS: Record<string, number> = {
  LED_BUILTIN: 13,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
};

/** Canonical mode name table. */
const MODE_MAP: Record<string, PinMode> = {
  INPUT: "INPUT",       "0": "INPUT",
  OUTPUT: "OUTPUT",     "1": "OUTPUT",
  INPUT_PULLUP: "INPUT_PULLUP", "2": "INPUT_PULLUP",
};

// Regex patterns for symbol resolution (S6353: use \w instead of [A-Za-z0-9_])
const DEFINE_PATTERN = /^#define\s+([A-Za-z_]\w*)\s+(\w+)/gm;
const CONST_PATTERN = /\bconst\s+(?:int|byte|uint8_t|uint16_t|short|long)\s+([A-Za-z_]\w*)\s*=\s*(\w+)\s*;/g;
const VAR_PATTERN = /\b(?:int|byte|uint8_t)\s+([A-Za-z_]\w*)\s*=\s*(\w+)\s*;/g;
const ARRAY_PATTERN = /\b(?:int|byte|uint8_t) +([A-Za-z_]\w*) *\[ *\d* *\] *= *\{([^}]+)\}/g; // NOSONAR S5843
// Two separate for-loop regexes to avoid super-linear backtracking (S5843):
// 1. With type prefix: for (int i = 0; ...)
const FOR_LOOP_TYPED = /\bfor\s*\(\s*\w+\s+(\w+)\s*=\s*(\d+)\s*;\s*(\w+)\s*([<>]=?)\s*(\w+)\s*;[^)]*\)/g;
// 2. Without type prefix: for (i = 0; ...)
const FOR_LOOP_BARE = /\bfor\s*\(\s*(\w+)\s*=\s*(\d+)\s*;\s*(\w+)\s*([<>]=?)\s*(\w+)\s*;[^)]*\)/g;
const FOR_BRACE_TAIL_RE = /^ *(\{)?/;
const ARRAY_ACCESS_PATTERN = /^([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/;
const FUNCTION_CALL_PATTERN = /\b(pinMode|digitalRead|digitalWrite|analogRead|analogWrite)\s*\(\s*(\w+(?:\[\d+\])?)(?:\s*,\s*(\w+))?/g;

type OpName =
  | "pinMode"
  | "digitalRead"
  | "digitalWrite"
  | "analogRead"
  | "analogWrite";

type PinModeType = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

interface CallEntry {
  op: OpName;
  pinId: number;
  line: number;
  mode?: PinMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment stripping (position-preserving)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip comments while preserving character positions (newlines kept intact).
 * This allows line numbers in the stripped code to match the original source.
 */
function stripComments(code: string): string {
  // Multi-line comments → spaces (preserve newlines for correct line counting)
  let result = code.replaceAll(/\/\*[^*]*(?:\*+[^*/][^*]*)*\*\//g, (m) =>
    m.replaceAll(/[^\n]/g, " "),
  );
  // Single-line comments → spaces (preserve line length)
  result = result.replaceAll(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return result;
}

/** 1-based line number for a character position in a string. */
function lineAt(code: string, pos: number): number {
  return code.slice(0, pos).split("\n").length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build symbol table: name → pin ID (0-19).
 * Handles: built-in constants, #define, const int/byte, plain int/byte.
 */
function buildSymbols(clean: string): Map<string, number> {
  const syms = new Map<string, number>(Object.entries(BUILTIN_CONSTANTS));

  // #define NAME VALUE
  let m: RegExpExecArray | null;
  while ((m = DEFINE_PATTERN.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) syms.set(m[1], v);
  }

  // const int/byte NAME = VALUE;
  while ((m = CONST_PATTERN.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) syms.set(m[1], v);
  }

  // plain int/byte NAME = VALUE; (common in Arduino, e.g. int led = 12;)
  while ((m = VAR_PATTERN.exec(clean)) !== null) {
    if (syms.has(m[1])) continue; // already set by const variant
    const v = resolveToken(m[2], syms);
    if (v !== undefined) syms.set(m[1], v);
  }

  return syms;
}

/** Resolve a single token (numeric literal, A0-A5, or symbol) to a pin ID. */
function resolveToken(
  token: string,
  syms: Map<string, number>,
): number | undefined {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  const analogMatch = /^A(\d+)$/.exec(token);
  if (analogMatch) {
    const n = Number.parseInt(analogMatch[1], 10);
    return n >= 0 && n <= 5 ? 14 + n : undefined;
  }
  return syms.get(token);
}

/**
 * Build array table: `int arr[] = {a, b, c}` → arr → [pinId, pinId, …].
 * Used to resolve array-index pin expressions like `pins[1]`.
 */
function buildArrays(
  clean: string,
  syms: Map<string, number>,
): Map<string, number[]> {
  const arrays = new Map<string, number[]>();
  let m: RegExpExecArray | null;
  while ((m = ARRAY_PATTERN.exec(clean)) !== null) {
    const vals = m[2]
      .split(",")
      .map((v) => resolveToken(v.trim(), syms));
    if (vals.every((v): v is number => v !== undefined)) {
      arrays.set(m[1], vals);
    }
  }
  return arrays;
}

/**
 * Resolve a pin expression (literal, symbol, or array-index) to a pin ID 0-19.
 * Returns undefined if the expression is not statically resolvable (→ TC 8).
 */
function resolvePin(
  expr: string,
  syms: Map<string, number>,
  arrays: Map<string, number[]>,
): number | undefined {
  const t = expr.trim();
  // Array access: name[index]
  const arrM = ARRAY_ACCESS_PATTERN.exec(t);
  if (arrM) {
    const arr = arrays.get(arrM[1]);
    const idx = Number.parseInt(arrM[2], 10);
    if (arr && idx < arr.length) {
      const id = arr[idx];
      return id >= 0 && id <= 19 ? id : undefined;
    }
    return undefined;
  }
  const n = resolveToken(t, syms);
  return n !== undefined && n >= 0 && n <= 19 ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// For-loop range detection
// ─────────────────────────────────────────────────────────────────────────────

interface LoopRange {
  startPos: number;
  endPos: number;
  startLine: number;
  variable: string;
  values: number[];
}

/**
 * Generate loop values based on operator and limits.
 * Uses data-driven approach to reduce cognitive complexity.
 */
function generateLoopValues(
  start: number,
  op: string,
  limitVal: number,
): number[] {
  const values: number[] = [];
  const compareFunc = getComparisonFunction(op);
  if (!compareFunc) return values;

  const direction = op === ">" || op === ">=" ? -1 : 1;
  let i = start;
  while (values.length <= 20) {
    if (!compareFunc(i, limitVal)) break;
    values.push(i);
    i += direction;
  }
  return values;
}

/**
 * Get comparison function for a given operator string.
 */
function getComparisonFunction(op: string): ((a: number, b: number) => boolean) | null {
  switch (op) {
    case "<":
      return (a, b) => a < b;
    case "<=":
      return (a, b) => a <= b;
    case ">":
      return (a, b) => a > b;
    case ">=":
      return (a, b) => a >= b;
    default:
      return null;
  }
}

/**
 * Find matching closing brace in a string starting from a given position.
 * Helper to reduce cognitive complexity in findLoopRanges.
 */
function findMatchingBrace(str: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return openPos;
}

/** Find the end position of a for-loop body (braced or braceless). */
function findLoopBodyEnd(
  clean: string,
  headerEnd: number,
  hasBrace: boolean,
): number {
  if (hasBrace) {
    let openBrace = headerEnd - 1;
    while (openBrace < clean.length && clean[openBrace] !== "{") openBrace++;
    return findMatchingBrace(clean, openBrace);
  }
  const semiPos = clean.indexOf(";", headerEnd);
  return semiPos >= 0 ? semiPos : clean.length;
}

/**
 * Find all for-loops with a numeric iteration variable over a statically
 * determinable range, e.g. `for (int i = 2; i < 4; i++)`.
 */
function findLoopRanges(
  clean: string,
  syms: Map<string, number>,
): LoopRange[] {
  const ranges: LoopRange[] = [];
  let m: RegExpExecArray | null;

  for (const forRe of [FOR_LOOP_TYPED, FOR_LOOP_BARE]) {
    forRe.lastIndex = 0;
    while ((m = forRe.exec(clean)) !== null) {
      const variable = m[1];
      const start = Number.parseInt(m[2], 10);
      const op = m[4];
      const limitVal = resolveToken(m[5], syms) ?? Number.parseInt(m[5], 10);
      if (Number.isNaN(limitVal)) continue;

      const values = generateLoopValues(start, op, limitVal);
      if (values.length === 0 || values.length > 20) continue;

      const tail = clean.slice(m.index + m[0].length);
      const hasBrace = !!FOR_BRACE_TAIL_RE.exec(tail)?.[1];
      const endPos = findLoopBodyEnd(clean, m.index + m[0].length, hasBrace);

      ranges.push({
        startPos: m.index,
        endPos,
        startLine: lineAt(clean, m.index),
        variable,
        values,
      });
    }
  }

  return ranges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect conflicts in pin mode and operation assignments.
 * Returns { pinModeConflict, operationConflict, outputReadConflict, hasInputMode, hasOutputMode }
 */
function detectPinConflicts(
  pmCalls: CallEntry[],
  drCalls: CallEntry[],
  dwCalls: CallEntry[],
  arCalls: CallEntry[],
  awCalls: CallEntry[],
): {
  pinModeConflict: boolean;
  operationConflict: boolean;
  outputReadConflict: boolean;
  uniqueModes: PinModeType[];
} {
  const allModes = pmCalls.map((c) => c.mode!);
  const uniqueModes = [...new Set(allModes)] as PinModeType[];

  // TC 11: same pin configured with multiple DIFFERENT modes
  const pinModeConflict = uniqueModes.length > 1;

  // TC 9: pin set to INPUT/INPUT_PULLUP AND written via digital/analogWrite
  const hasInputMode =
    pmCalls.length > 0 &&
    (uniqueModes.includes("INPUT") || uniqueModes.includes("INPUT_PULLUP"));
  const hasWrite = dwCalls.length > 0 || awCalls.length > 0;
  const operationConflict = hasInputMode && hasWrite;

  // TC 9b: pin set to OUTPUT AND read via digital/analogRead
  const hasOutputMode =
    pmCalls.length > 0 && uniqueModes.includes("OUTPUT");
  const hasRead = drCalls.length > 0 || arCalls.length > 0;
  const outputReadConflict = hasOutputMode && hasRead;

  return {
    pinModeConflict,
    operationConflict,
    outputReadConflict,
    uniqueModes,
  };
}

/**
 * Generate conflict message based on detected conflict type.
 */
function generateConflictMessage(
  pinModeConflict: boolean,
  operationConflict: boolean,
  outputReadConflict: boolean,
  uniqueModes: PinModeType[],
): string {
  if (pinModeConflict) {
    return `Multiple modes: ${uniqueModes.join(", ")}`;
  }
  if (operationConflict) {
    const nonOutputModes = uniqueModes.filter((mm) => mm !== "OUTPUT");
    return `Write on ${nonOutputModes.join("/")} pin`;
  }
  if (outputReadConflict) {
    return "Read on OUTPUT pin";
  }
  return "";
}

/**
 * Process an expanded for-loop variable and add entries to the list.
 */
function processLoopExpansion(
  loop: LoopRange,
  op: OpName,
  secondArg: string,
  entries: CallEntry[],
): void {
  for (const pinId of loop.values) {
    if (pinId < 0 || pinId > 19) continue;
    if (op === "pinMode") {
      const mode = MODE_MAP[secondArg];
      if (!mode) continue;
      entries.push({ op, pinId, line: loop.startLine, mode });
    } else {
      entries.push({ op, pinId, line: loop.startLine });
    }
  }
}

/**
 * Process a statically-resolved pin and add entry to the list.
 */
function processStaticPin(
  pinId: number,
  op: OpName,
  secondArg: string,
  callLine: number,
  entries: CallEntry[],
): void {
  if (op === "pinMode") {
    const mode = MODE_MAP[secondArg];
    if (!mode) return;
    entries.push({ op, pinId, line: callLine, mode });
  } else {
    entries.push({ op, pinId, line: callLine });
  }
}

interface CallContext {
  loops: LoopRange[];
  syms: Map<string, number>;
  arrays: Map<string, number[]>;
  entries: CallEntry[];
}

/**
 * Process a single function call and add entries to the entries list.
 * Handles for-loop expansion and static pin resolution.
 */
function processCallExpression(
  op: OpName,
  pinExpr: string,
  secondArg: string,
  callPos: number,
  callLine: number,
  ctx: CallContext,
): void {
  const { loops, syms, arrays, entries } = ctx;
  // ── Check for-loop variable expansion (TC 3) ──────────────────────────
  const loop = loops.find(
    (l) => l.startPos <= callPos && callPos <= l.endPos && l.variable === pinExpr,
  );

  if (loop) {
    processLoopExpansion(loop, op, secondArg, entries);
    return;
  }

  // ── Statically resolve pin expression ────────────────────────────────
  const pinId = resolvePin(pinExpr, syms, arrays);
  if (pinId === undefined) return; // TC 8: dynamic → skip (runtime only)

  processStaticPin(pinId, op, secondArg, callLine, entries);
}

/**
 * Populate extended-view line arrays in IOPinRecord.
 */
function populateLineArrays(
  record: IOPinRecord,
  pmCalls: CallEntry[],
  drCalls: CallEntry[],
  dwCalls: CallEntry[],
  arCalls: CallEntry[],
  awCalls: CallEntry[],
): void {
  if (pmCalls.length > 0) {
    record.pinModeLines = pmCalls.map((c) => c.line);
    record.pinModeModes = pmCalls
      .map((c) => c.mode)
      .filter((m): m is PinMode => m !== undefined);
  }
  if (drCalls.length > 0) {
    record.digitalReadLines = drCalls.map((c) => c.line);
  }
  if (dwCalls.length > 0) {
    record.digitalWriteLines = dwCalls.map((c) => c.line);
  }
  if (arCalls.length > 0) {
    record.analogReadLines = arCalls.map((c) => c.line);
  }
  if (awCalls.length > 0) {
    record.analogWriteLines = awCalls.map((c) => c.line);
  }
}

/**
 * Populate legacy fields for backward compatibility with runtime registry.
 */
function populateLegacyFields(
  record: IOPinRecord,
  pmCalls: CallEntry[],
  drCalls: CallEntry[],
  dwCalls: CallEntry[],
  arCalls: CallEntry[],
  awCalls: CallEntry[],
): void {
  if (pmCalls.length > 0) {
    const allModes = pmCalls
      .map((c) => c.mode)
      .filter((m): m is PinMode => m !== undefined);
    const lastMode = allModes.at(-1);
    record.pinMode = convertModeToNumeric(lastMode);
    record.definedAt = { line: pmCalls.at(-1).line };
  }

  const nonPmCalls = [...drCalls, ...dwCalls, ...arCalls, ...awCalls];
  if (nonPmCalls.length > 0) {
    record.usedAt = nonPmCalls.map((c) => ({
      line: c.line,
      operation: c.op,
    }));
  }
}

/**
 * Convert PinMode string to numeric representation for legacy compatibility.
 */
function convertModeToNumeric(mode: PinMode | undefined): number {
  switch (mode) {
    case "INPUT":
      return 0;
    case "OUTPUT":
      return 1;
    case "INPUT_PULLUP":
      return 2;
    default:
      return 0;
  }
}

/**
 * Build a single IOPinRecord from aggregated call entries for a pin.
 */
function buildPinRecord(
  pinId: number,
  calls: CallEntry[],
  pmCalls: CallEntry[],
  drCalls: CallEntry[],
  dwCalls: CallEntry[],
  arCalls: CallEntry[],
  awCalls: CallEntry[],
): IOPinRecord {
  const label = pinId >= 14 ? `A${pinId - 14}` : String(pinId);

  const conflicts = detectPinConflicts(
    pmCalls,
    drCalls,
    dwCalls,
    arCalls,
    awCalls,
  );

  const conflict =
    conflicts.pinModeConflict ||
    conflicts.operationConflict ||
    conflicts.outputReadConflict;

  const record: IOPinRecord = {
    pin: label,
    pinId,
    defined: calls.length > 0,
  };

  if (conflict) {
    record.conflict = true;
    record.conflictMessage = generateConflictMessage(
      conflicts.pinModeConflict,
      conflicts.operationConflict,
      conflicts.outputReadConflict,
      conflicts.uniqueModes,
    );
  }

  populateLineArrays(record, pmCalls, drCalls, dwCalls, arCalls, awCalls);
  populateLegacyFields(record, pmCalls, drCalls, dwCalls, arCalls, awCalls);

  return record;
}

/**
 * Statically parse an Arduino sketch and return an IOPinRecord[] for every pin
 * usage found in the source code.
 *
 * – Populates `pinModeLines`, `digitalReadLines`, `digitalWriteLines`,
 *   `analogReadLines`, `analogWriteLines` for the extended (eye-on) view.
 * – Sets `conflict = true` for TC 9 (write on input-mode pin) and
 *   TC 11 (same pin configured with multiple different modes).
 * – Dynamically-resolved pins (TC 8) are silently skipped; they will be
 *   filled in by the runtime path.
 * – Populates legacy `pinMode`, `definedAt`, `usedAt` fields for backward
 *   compatibility with the existing UI and runtime registry manager.
 */
export function parseStaticIORegistry(code: string): IOPinRecord[] {
  const clean = stripComments(code);
  const syms = buildSymbols(clean);
  const arrays = buildArrays(clean, syms);
  const loops = findLoopRanges(clean, syms);

  const entries: CallEntry[] = [];

  /**
   * Regex captures:
   *   [1] function name
   *   [2] pin expression: array-index form OR simple token/number
   *   [3] optional second argument (mode for pinMode, ignored otherwise)
   */

  let m: RegExpExecArray | null;
  while ((m = FUNCTION_CALL_PATTERN.exec(clean)) !== null) {
    const op = m[1] as OpName;
    const pinExpr = m[2].trim();
    const secondArg = (m[3] ?? "").trim();
    const callPos = m.index;
    const callLine = lineAt(clean, callPos);

    processCallExpression(
      op,
      pinExpr,
      secondArg,
      callPos,
      callLine,
      { loops, syms, arrays, entries },
    );
  }

  // ── Aggregate entries by pinId ────────────────────────────────────────────
  const pinMap = new Map<number, CallEntry[]>();
  for (const entry of entries) {
    const existing = pinMap.get(entry.pinId);
    if (existing) {
      existing.push(entry);
    } else {
      pinMap.set(entry.pinId, [entry]);
    }
  }

  const records: IOPinRecord[] = [];

  for (const [pinId, calls] of pinMap) {
    const pmCalls = calls.filter((c) => c.op === "pinMode");
    const drCalls = calls.filter((c) => c.op === "digitalRead");
    const dwCalls = calls.filter((c) => c.op === "digitalWrite");
    const arCalls = calls.filter((c) => c.op === "analogRead");
    const awCalls = calls.filter((c) => c.op === "analogWrite");

    const record = buildPinRecord(
      pinId,
      calls,
      pmCalls,
      drCalls,
      dwCalls,
      arCalls,
      awCalls,
    );

    records.push(record);
  }

  // Sort by pinId (0 → 19)
  return records.sort((a, b) => (a.pinId ?? 0) - (b.pinId ?? 0));
}

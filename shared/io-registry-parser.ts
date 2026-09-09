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
import {
  FOR_LOOP_TYPED,
  FOR_LOOP_BARE,
  stripComments,
  lineAt,
} from "@shared/parser-patterns";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
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
const ARRAY_PATTERN = /\b(?:const\s+)?(?:int|byte|uint8_t)\s+([A-Za-z_]\w*)\s*\[\s*(?:\d+|[A-Za-z_]\w*)?\s*\]\s*=\s*\{([^}]+)\}/g; // NOSONAR S5843
const FOR_BRACE_TAIL_RE = /^ *(\{)?/;
const ARRAY_ACCESS_PATTERN = /^([A-Za-z_]\w*)\s*\[\s*(\d+|[A-Za-z_]\w*)\s*\]$/;
const FUNCTION_CALL_PATTERN = /\b(pinMode|digitalRead|digitalWrite|analogRead|analogWrite)\s*\(\s*(\w+(?:\[\w+\])?)(?:\s*,\s*(\w+))?/g;

export type StaticIOOperation =
  | "pinMode"
  | "digitalRead"
  | "digitalWrite"
  | "analogRead"
  | "analogWrite";

export interface StaticIOCall {
  op: StaticIOOperation;
  pinId: number;
  line: number;
  sourceExpression: string;
  mode?: PinMode;
  loopBody?: "braced" | "braceless";
}

/** An I/O call whose pin expression cannot be resolved without executing it. */
export interface UnresolvedStaticIOCall {
  op: StaticIOOperation;
  line: number;
  sourceExpression: string;
  mode?: PinMode;
}

/** Canonical statically-resolved I/O facts for one Arduino pin. */
export interface StaticIOPinAnalysis {
  pinId: number;
  calls: StaticIOCall[];
}

/**
 * Canonical result of the best-effort static I/O analysis.
 *
 * Only unambiguously resolved pins are included. Dynamic or unsupported
 * expressions remain the responsibility of the runtime registry.
 */
export interface StaticIOAnalysis {
  pins: StaticIOPinAnalysis[];
  unresolvedCalls: UnresolvedStaticIOCall[];
  symbols: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build symbol table: name → pin ID (0-19).
 * Handles: built-in constants, #define, const int/byte, plain int/byte.
 */
function buildSymbols(clean: string): {
  values: Map<string, number>;
  userSymbols: Set<string>;
} {
  const syms = new Map<string, number>(Object.entries(BUILTIN_CONSTANTS));
  const userSymbols = new Set<string>();

  // #define NAME VALUE
  let m: RegExpExecArray | null;
  while ((m = DEFINE_PATTERN.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) {
      syms.set(m[1], v);
      userSymbols.add(m[1]);
    }
  }

  // const int/byte NAME = VALUE;
  while ((m = CONST_PATTERN.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) {
      syms.set(m[1], v);
      userSymbols.add(m[1]);
    }
  }

  // plain int/byte NAME = VALUE; (common in Arduino, e.g. int led = 12;)
  while ((m = VAR_PATTERN.exec(clean)) !== null) {
    if (syms.has(m[1])) continue; // already set by const variant
    const v = resolveToken(m[2], syms);
    if (v !== undefined) {
      syms.set(m[1], v);
      userSymbols.add(m[1]);
    }
  }

  return { values: syms, userSymbols };
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
  hasBrace: boolean;
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
  return str.length;
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
      // FOR_LOOP_TYPED: groups are [full, type, var, start, op, limit]
      // FOR_LOOP_BARE: groups are [full, empty, var, start, op, limit]
      const variable = m[2];
      const start = Number.parseInt(m[3], 10);
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
        hasBrace,
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
  pmCalls: StaticIOCall[],
  drCalls: StaticIOCall[],
  dwCalls: StaticIOCall[],
  arCalls: StaticIOCall[],
  awCalls: StaticIOCall[],
): {
  pinModeConflict: boolean;
  operationConflict: boolean;
  outputReadConflict: boolean;
  uniqueModes: PinMode[];
} {
  const allModes = pmCalls.map((c) => c.mode);
  const uniqueModes = [...new Set(allModes)] as PinMode[];

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
  uniqueModes: PinMode[],
): string {
  if (pinModeConflict) {
    return `Multiple modes: ${[...uniqueModes].join(", ")}`;
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
  op: StaticIOOperation,
  sourceExpression: string,
  secondArg: string,
  entries: StaticIOCall[],
): void {
  for (const pinId of loop.values) {
    if (pinId < 0 || pinId > 19) continue;
    processStaticPin(
      pinId,
      op,
      sourceExpression,
      secondArg,
      loop.startLine,
      entries,
      loop.hasBrace ? "braced" : "braceless",
    );
  }
}

/** Expand an array access whose index is the active loop variable. */
function processArrayLoopExpansion(
  loop: LoopRange,
  arrayName: string,
  op: StaticIOOperation,
  sourceExpression: string,
  secondArg: string,
  arrays: Map<string, number[]>,
  entries: StaticIOCall[],
): boolean {
  const values = arrays.get(arrayName);
  if (!values) return false;

  for (const index of loop.values) {
    const pinId = values[index];
    if (pinId !== undefined) {
      processStaticPin(
        pinId,
        op,
        sourceExpression,
        secondArg,
        loop.startLine,
        entries,
        loop.hasBrace ? "braced" : "braceless",
      );
    }
  }
  return true;
}

/**
 * Process a statically-resolved pin and add entry to the list.
 */
function processStaticPin(
  pinId: number,
  op: StaticIOOperation,
  sourceExpression: string,
  secondArg: string,
  callLine: number,
  entries: StaticIOCall[],
  loopBody?: "braced" | "braceless",
): void {
  const resolvedPinId =
    op === "analogRead" && pinId >= 0 && pinId <= 5 ? pinId + 14 : pinId;
  const loopContext = loopBody === undefined ? {} : { loopBody };
  if (op === "pinMode") {
    const mode = MODE_MAP[secondArg];
    if (!mode) return;
    entries.push({
      op,
      pinId: resolvedPinId,
      line: callLine,
      sourceExpression,
      mode,
      ...loopContext,
    });
  } else {
    entries.push({
      op,
      pinId: resolvedPinId,
      line: callLine,
      sourceExpression,
      ...loopContext,
    });
  }
}

interface CallContext {
  loops: LoopRange[];
  syms: Map<string, number>;
  arrays: Map<string, number[]>;
  entries: StaticIOCall[];
  unresolvedCalls: UnresolvedStaticIOCall[];
}

/**
 * Process a single function call and add entries to the entries list.
 * Handles for-loop expansion and static pin resolution.
 */
function processCallExpression(
  op: StaticIOOperation,
  pinExpr: string,
  secondArg: string,
  callPos: number,
  callLine: number,
  ctx: CallContext,
): void {
  const { loops, syms, arrays, entries, unresolvedCalls } = ctx;
  if (op === "pinMode" && !MODE_MAP[secondArg]) {
    unresolvedCalls.push({
      op,
      line: callLine,
      sourceExpression: pinExpr,
    });
    return;
  }

  // ── Check for-loop variable expansion (TC 3) ──────────────────────────
  const loop = loops.find(
    (l) => {
      if (l.startPos > callPos || callPos > l.endPos) return false;
      if (l.variable === pinExpr) return true;
      const arrayAccess = ARRAY_ACCESS_PATTERN.exec(pinExpr);
      return arrayAccess?.[2] === l.variable;
    },
  );

  if (loop) {
    const arrayAccess = ARRAY_ACCESS_PATTERN.exec(pinExpr);
    if (arrayAccess?.[2] === loop.variable) {
      const expanded = processArrayLoopExpansion(
        loop,
        arrayAccess[1],
        op,
        pinExpr,
        secondArg,
        arrays,
        entries,
      );
      if (!expanded) {
        unresolvedCalls.push({
          op,
          line: callLine,
          sourceExpression: pinExpr,
          mode: MODE_MAP[secondArg],
        });
      }
      return;
    }
    processLoopExpansion(loop, op, pinExpr, secondArg, entries);
    return;
  }

  // ── Statically resolve pin expression ────────────────────────────────
  const pinId = resolvePin(pinExpr, syms, arrays);
  if (pinId === undefined) {
    unresolvedCalls.push({
      op,
      line: callLine,
      sourceExpression: pinExpr,
      mode: MODE_MAP[secondArg],
    });
    return;
  }

  processStaticPin(pinId, op, pinExpr, secondArg, callLine, entries);
}

/**
 * Populate extended-view line arrays in IOPinRecord.
 */
function populateLineArrays(
  record: IOPinRecord,
  pmCalls: StaticIOCall[],
  drCalls: StaticIOCall[],
  dwCalls: StaticIOCall[],
  arCalls: StaticIOCall[],
  awCalls: StaticIOCall[],
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
  pmCalls: StaticIOCall[],
  drCalls: StaticIOCall[],
  dwCalls: StaticIOCall[],
  arCalls: StaticIOCall[],
  awCalls: StaticIOCall[],
): void {
  if (pmCalls.length > 0) {
    const allModes = pmCalls
      .map((c) => c.mode)
      .filter((m): m is PinMode => m !== undefined);
    const lastMode = allModes.at(-1);
    // eslint-disable-next-line unicorn/prefer-at -- .at(-1) returns T|undefined, not narrowed by length guard
    const lastPmCall = pmCalls[pmCalls.length - 1];
    record.pinMode = convertModeToNumeric(lastMode);
    record.definedAt = { line: lastPmCall.line };
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
  calls: StaticIOCall[],
  pmCalls: StaticIOCall[],
  drCalls: StaticIOCall[],
  dwCalls: StaticIOCall[],
  arCalls: StaticIOCall[],
  awCalls: StaticIOCall[],
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

/** Analyze statically resolvable Arduino I/O usage without applying a UI projection. */
export function analyzeStaticIO(code: string): StaticIOAnalysis {
  const clean = stripComments(code);
  const { values: syms, userSymbols } = buildSymbols(clean);
  const arrays = buildArrays(clean, syms);
  const loops = findLoopRanges(clean, syms);

  const entries: StaticIOCall[] = [];
  const unresolvedCalls: UnresolvedStaticIOCall[] = [];

  /**
   * Regex captures:
   *   [1] function name
   *   [2] pin expression: array-index form OR simple token/number
   *   [3] optional second argument (mode for pinMode, ignored otherwise)
   */

  let m: RegExpExecArray | null;
  while ((m = FUNCTION_CALL_PATTERN.exec(clean)) !== null) {
    const op = m[1] as StaticIOOperation;
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
      { loops, syms, arrays, entries, unresolvedCalls },
    );
  }

  // ── Aggregate entries by pinId ────────────────────────────────────────────
  const pinMap = new Map<number, StaticIOCall[]>();
  for (const entry of entries) {
    const existing = pinMap.get(entry.pinId);
    if (existing) {
      existing.push(entry);
    } else {
      pinMap.set(entry.pinId, [entry]);
    }
  }

  const pins = [...pinMap].map(([pinId, calls]) => ({ pinId, calls }));
  pins.sort((a, b) => a.pinId - b.pinId);
  const symbols = Object.fromEntries(
    [...userSymbols].map((name) => [name, syms.get(name) as number]),
  );
  return { pins, unresolvedCalls, symbols };
}

/** Project canonical static I/O facts to the existing registry contract. */
function buildStaticIORegistry(analysis: StaticIOAnalysis): IOPinRecord[] {
  const records: IOPinRecord[] = [];

  for (const { pinId, calls } of analysis.pins) {
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
  return buildStaticIORegistry(analyzeStaticIO(code));
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Built-in Arduino pin-name constants mapped to numeric IDs (0-19). */
const BUILTIN_CONSTANTS: Record<string, number> = {
  LED_BUILTIN: 13,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
};

/** Canonical mode name table. */
const MODE_MAP: Record<string, "INPUT" | "OUTPUT" | "INPUT_PULLUP"> = {
  INPUT: "INPUT",       "0": "INPUT",
  OUTPUT: "OUTPUT",     "1": "OUTPUT",
  INPUT_PULLUP: "INPUT_PULLUP", "2": "INPUT_PULLUP",
};

type OpName =
  | "pinMode"
  | "digitalRead"
  | "digitalWrite"
  | "analogRead"
  | "analogWrite";

interface CallEntry {
  op: OpName;
  pinId: number;
  line: number;
  mode?: "INPUT" | "OUTPUT" | "INPUT_PULLUP";
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
  let result = code.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  // Single-line comments → spaces (preserve line length)
  result = result.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
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
  const defineRe = /^#define\s+([A-Za-z_]\w*)\s+([A-Za-z0-9_]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = defineRe.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) syms.set(m[1], v);
  }

  // const int/byte NAME = VALUE;
  const constRe =
    /\bconst\s+(?:int|byte|uint8_t|uint16_t|short|long)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z0-9_]+)\s*;/g;
  while ((m = constRe.exec(clean)) !== null) {
    const v = resolveToken(m[2], syms);
    if (v !== undefined) syms.set(m[1], v);
  }

  // plain int/byte NAME = VALUE; (common in Arduino, e.g. int led = 12;)
  const varRe =
    /\b(?:int|byte|uint8_t)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z0-9_]+)\s*;/g;
  while ((m = varRe.exec(clean)) !== null) {
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
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  const analogMatch = /^A(\d+)$/.exec(token);
  if (analogMatch) {
    const n = parseInt(analogMatch[1], 10);
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
  const re =
    /\b(?:int|byte|uint8_t)\s+([A-Za-z_]\w*)\s*\[\s*\d*\s*\]\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const vals = m[2]
      .split(",")
      .map((v) => resolveToken(v.trim(), syms));
    if (vals.every((v) => v !== undefined)) {
      arrays.set(m[1], vals as number[]);
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
  const arrM = /^([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/.exec(t);
  if (arrM) {
    const arr = arrays.get(arrM[1]);
    const idx = parseInt(arrM[2], 10);
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
 * Find all for-loops with a numeric iteration variable over a statically
 * determinable range, e.g. `for (int i = 2; i < 4; i++)`.
 */
function findLoopRanges(
  clean: string,
  syms: Map<string, number>,
): LoopRange[] {
  const ranges: LoopRange[] = [];
  // The opening brace (\{)? is made optional so that braceless single-statement
  // loop bodies are also handled, e.g.:
  //   for (int i = 1; i <= 6; i++) pinMode(i, INPUT);
  const re =
    /\bfor\s*\(\s*(?:(?:byte|int|uint8_t|short)\s+)?([A-Za-z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*([<>]=?)\s*([A-Za-z0-9_]+)\s*;[^)]*\)\s*(\{)?/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(clean)) !== null) {
    const variable = m[1];
    const start = parseInt(m[2], 10);
    const op = m[3];
    const limitVal = resolveToken(m[4], syms) ?? parseInt(m[4], 10);
    const hasBrace = !!m[5];
    if (isNaN(limitVal)) continue;

    const values: number[] = [];
    if (op === "<")
      for (let i = start; i < limitVal && values.length <= 20; i++)
        values.push(i);
    if (op === "<=")
      for (let i = start; i <= limitVal && values.length <= 20; i++)
        values.push(i);
    if (op === ">")
      for (let i = start; i > limitVal && values.length <= 20; i--)
        values.push(i);
    if (op === ">=")
      for (let i = start; i >= limitVal && values.length <= 20; i--)
        values.push(i);

    if (values.length === 0 || values.length > 20) continue;

    let endPos: number;
    if (hasBrace) {
      // Braced body: find the matching closing brace
      let openBrace = m.index + m[0].length - 1;
      while (openBrace < clean.length && clean[openBrace] !== "{") openBrace++;
      let depth = 0;
      endPos = openBrace;
      for (let i = openBrace; i < clean.length; i++) {
        if (clean[i] === "{") depth++;
        else if (clean[i] === "}") {
          depth--;
          if (depth === 0) {
            endPos = i;
            break;
          }
        }
      }
    } else {
      // Braceless body: the single statement ends at the first ";" after the header
      const bodyStart = m.index + m[0].length;
      const semiPos = clean.indexOf(";", bodyStart);
      endPos = semiPos >= 0 ? semiPos : clean.length;
    }

    ranges.push({
      startPos: m.index,
      endPos,
      startLine: lineAt(clean, m.index),
      variable,
      values,
    });
  }

  return ranges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main exported function
// ─────────────────────────────────────────────────────────────────────────────

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
  const callRe =
    /\b(pinMode|digitalRead|digitalWrite|analogRead|analogWrite)\s*\(\s*((?:[A-Za-z_]\w*\s*\[\s*\d+\s*\])|(?:[A-Za-z_]\w*|\d+))(?:\s*,\s*([A-Za-z_]\w*|\d+))?/g;

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(clean)) !== null) {
    const op = m[1] as OpName;
    const pinExpr = m[2].trim();
    const secondArg = (m[3] ?? "").trim();
    const callPos = m.index;
    const callLine = lineAt(clean, callPos);

    // ── Check for-loop variable expansion (TC 3) ──────────────────────────
    const loop = loops.find(
      (l) =>
        l.startPos <= callPos &&
        callPos <= l.endPos &&
        l.variable === pinExpr,
    );

    if (loop) {
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
      continue;
    }

    // ── Statically resolve pin expression ────────────────────────────────
    const pinId = resolvePin(pinExpr, syms, arrays);
    if (pinId === undefined) continue; // TC 8: dynamic → skip (runtime only)

    if (op === "pinMode") {
      const mode = MODE_MAP[secondArg];
      if (!mode) continue; // mode not statically resolvable
      entries.push({ op, pinId, line: callLine, mode });
    } else {
      entries.push({ op, pinId, line: callLine });
    }
  }

  // ── Aggregate entries by pinId ────────────────────────────────────────────
  const pinMap = new Map<number, CallEntry[]>();
  for (const entry of entries) {
    if (!pinMap.has(entry.pinId)) pinMap.set(entry.pinId, []);
    pinMap.get(entry.pinId)!.push(entry);
  }

  const records: IOPinRecord[] = [];

  for (const [pinId, calls] of pinMap) {
    const label = pinId >= 14 ? `A${pinId - 14}` : String(pinId);

    const pmCalls = calls.filter((c) => c.op === "pinMode");
    const drCalls = calls.filter((c) => c.op === "digitalRead");
    const dwCalls = calls.filter((c) => c.op === "digitalWrite");
    const arCalls = calls.filter((c) => c.op === "analogRead");
    const awCalls = calls.filter((c) => c.op === "analogWrite");

    const allModes = pmCalls.map((c) => c.mode!);
    const uniqueModes = [...new Set(allModes)] as Array<
      "INPUT" | "OUTPUT" | "INPUT_PULLUP"
    >;

    // TC 11: same pin configured with multiple DIFFERENT modes → conflict
    const pinModeConflict = uniqueModes.length > 1;

    // TC 9: pin set to INPUT/INPUT_PULLUP AND written via digital/analogWrite
    const hasInputMode =
      pmCalls.length > 0 &&
      uniqueModes.some((mm) => mm === "INPUT" || mm === "INPUT_PULLUP");
    const hasWrite = dwCalls.length > 0 || awCalls.length > 0;
    const operationConflict = hasInputMode && hasWrite;

    // TC 9b: pin set to OUTPUT AND read via digital/analogRead
    const hasOutputMode =
      pmCalls.length > 0 && uniqueModes.some((mm) => mm === "OUTPUT");
    const hasRead = drCalls.length > 0 || arCalls.length > 0;
    const outputReadConflict = hasOutputMode && hasRead;

    const conflict = pinModeConflict || operationConflict || outputReadConflict;

    const record: IOPinRecord = {
      pin: label,
      pinId,
      defined: calls.length > 0,
    };

    if (conflict) {
      record.conflict = true;
      record.conflictMessage = pinModeConflict
        ? `Multiple modes: ${uniqueModes.join(", ")}`
        : operationConflict
          ? `Write on ${uniqueModes
              .filter((mm) => mm !== "OUTPUT")
              .join("/")} pin`
          : `Read on OUTPUT pin`;
    }

    // ── New extended-view line arrays ────────────────────────────────────
    if (pmCalls.length > 0) {
      record.pinModeLines = pmCalls.map((c) => c.line);
      record.pinModeModes = pmCalls.map((c) => c.mode!);
    }
    if (drCalls.length > 0)
      record.digitalReadLines = drCalls.map((c) => c.line);
    if (dwCalls.length > 0)
      record.digitalWriteLines = dwCalls.map((c) => c.line);
    if (arCalls.length > 0)
      record.analogReadLines = arCalls.map((c) => c.line);
    if (awCalls.length > 0)
      record.analogWriteLines = awCalls.map((c) => c.line);

    // ── Legacy fields (backward compat with runtime registry manager) ────
    if (pmCalls.length > 0) {
      const lastMode = allModes[allModes.length - 1];
      record.pinMode =
        lastMode === "INPUT" ? 0 : lastMode === "OUTPUT" ? 1 : 2;
      record.definedAt = { line: pmCalls[pmCalls.length - 1].line };
    }

    const nonPmCalls = [...drCalls, ...dwCalls, ...arCalls, ...awCalls];
    if (nonPmCalls.length > 0) {
      record.usedAt = nonPmCalls.map((c) => ({
        line: c.line,
        operation: c.op,
      }));
    }

    records.push(record);
  }

  // Sort by pinId (0 → 19)
  return records.sort((a, b) => (a.pinId ?? 0) - (b.pinId ?? 0));
}

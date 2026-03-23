import { useMemo } from "react";

type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

interface SketchAnalysisResult {
  analogPins: number[]; // concrete Arduino pin numbers (A0 -> 14)
  varMap: Record<string, number>;
  detectedPinModes: Record<number, PinMode>;
  pendingPinConflicts: number[]; // pins that are both used as analogRead and declared via pinMode
  digitalPinsFromPinMode: number[];
}

// ─── Atomic regex patterns (reduced complexity) ─────────────────────────────

/** Match "Ax" tokens (A0–A5). */
const A_PIN_RE = /^A(\d+)$/i;

/** Match numeric tokens (0–255). */
const NUMERIC_RE = /^\d+$/;

/** Match simple tokens (A\d, \d+, or alphanumeric). */
const SIMPLE_TOKEN_RE = /^(A\d+|\d+|\w+)$/i;

/** Match #define VAR Ax or #define VAR numeric. */
const DEFINE_PIN_RE = /#define\s+(\w+)\s+(A\d|\d+)/g;

/** Match int/const/uint8_t VAR = Ax or numeric assignment. */
const ASSIGN_PIN_RE = /(?:int|const\s+int|uint8_t|byte)\s+(\w+)\s*=\s*(A\d|\d+)\s*;/g;

/** Match analogRead(token) calls. */
const ANALOG_READ_RE = /analogRead\s*\(\s*([^)]+)\s*\)/g;

/** Match for-loop pattern with integer iteration. */
const FOR_LOOP_RE = /for\s*\(\s*(?:byte|int|unsigned|uint8_t)?\s*(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;[^)]*\)\s*\{([\s\S]*?)\}/g;

/** Match pinMode(pin, mode) calls. */
const PIN_MODE_RE = /pinMode\s*\(\s*(A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;

// ─── Pin-token helpers ────────────────────────────────────────────────────────

/** Resolves an "Ax" token (e.g. "A2") to internal pin 14–19, or undefined. */
function resolveAPin(token: string): number | undefined {
  const m = A_PIN_RE.exec(token);
  if (!m) return undefined;
  const idx = Number(m[1]);
  return idx >= 0 && idx <= 5 ? 14 + idx : undefined;
}

/**
 * Resolves a numeric token for analogRead / define context:
 *   0–5   → mapped to 14–19
 *   14–19 → kept as-is
 *   otherwise → undefined
 */
function resolveNumericForAnalog(token: string): number | undefined {
  if (!NUMERIC_RE.test(token)) return undefined;
  const idx = Number(token);
  if (idx >= 0 && idx <= 5) return 14 + idx;
  if (idx >= 14 && idx <= 19) return idx;
  return undefined;
}

/** Resolves a define/assignment token ("A2" or numeric) to a pin number. */
function parsePinToken(token: string): number | undefined {
  return resolveAPin(token) ?? resolveNumericForAnalog(token);
}

/** Resolves an analogRead argument token to a pin number (includes varMap lookup). */
function resolveAnalogReadToken(
  tok: string,
  varMap: Map<string, number>,
): number | undefined {
  const aPin = resolveAPin(tok);
  if (aPin !== undefined) return aPin;
  if (NUMERIC_RE.test(tok)) return resolveNumericForAnalog(tok);
  return varMap.get(tok);
}

/**
 * Resolves a pinMode pin argument:
 *   "Ax" → 14+x (for x 0–5)
 *   numeric 0–255 → kept as-is
 */
function resolvePinModeToken(token: string): number | undefined {
  const aPin = resolveAPin(token);
  if (aPin !== undefined) return aPin;
  if (NUMERIC_RE.test(token)) {
    const idx = Number(token);
    if (idx >= 0 && idx <= 255) return idx;
  }
  return undefined;
}

/** Maps a raw modeToken string to a typed PinMode value. */
function resolvePinMode(modeToken: string): PinMode {
  if (modeToken === "INPUT_PULLUP") return "INPUT_PULLUP";
  if (modeToken === "OUTPUT") return "OUTPUT";
  return "INPUT";
}

// ─── Analysis passes ─────────────────────────────────────────────────────────

/** Extracts variable→pin mappings from #define macros and variable declarations. */
function extractVarMap(code: string): Map<string, number> {
  const varMap = new Map<string, number>();

  // #define VAR A0  or  #define VAR 0
  let m: RegExpExecArray | null = null;
  while ((m = DEFINE_PIN_RE.exec(code))) {
    const p = parsePinToken(m[2]);
    if (p !== undefined) varMap.set(m[1], p);
  }

  // int sensorPin = A0;  or  const int s = 0;
  while ((m = ASSIGN_PIN_RE.exec(code))) {
    const p = parsePinToken(m[2]);
    if (p !== undefined) varMap.set(m[1], p);
  }

  return varMap;
}

/** Finds all analog pins referenced via analogRead(...) calls. */
function findAnalogReadPins(
  code: string,
  varMap: Map<string, number>,
): Set<number> {
  const pins = new Set<number>();
  let m: RegExpExecArray | null = null;

  while ((m = ANALOG_READ_RE.exec(code))) {
    const token = m[1].trim();
    const simple = SIMPLE_TOKEN_RE.exec(token);
    if (!simple) continue;
    const pin = resolveAnalogReadToken(simple[1], varMap);
    if (pin !== undefined) pins.add(pin);
  }
  return pins;
}

/** Finds analog pins iterated in for-loops and used in analogRead. */
function findForLoopPins(code: string): Set<number> {
  const pins = new Set<number>();
  let fm: RegExpExecArray | null = null;

  while ((fm = FOR_LOOP_RE.exec(code))) {
    const [, varName, startStr, cmp, endStr, body] = fm;
    const useRe = new RegExp(
      String.raw`analogRead\s*\(\s*${varName}\s*\)`,
      "g",
    );
    if (!useRe.test(body)) continue;
    const start = Number(startStr);
    const last = cmp === "<=" ? Number(endStr) : Number(endStr) - 1;
    for (let pin = start; pin <= last; pin++) {
      if (pin >= 0 && pin <= 5) pins.add(14 + pin);
      else if (pin >= 14 && pin <= 19) pins.add(pin);
    }
  }
  return pins;
}

interface PinModeResult {
  modes: Record<number, PinMode>;
  pins: Set<number>;
}

/** Finds all pins declared via pinMode(...) and their configured modes. */
function findPinModePins(code: string): PinModeResult {
  const modes: Record<number, PinMode> = {};
  const pins = new Set<number>();
  let m: RegExpExecArray | null = null;

  while ((m = PIN_MODE_RE.exec(code))) {
    const p = resolvePinModeToken(m[1]);
    if (p === undefined) continue;
    pins.add(p);
    modes[p] = resolvePinMode(m[2]);
  }
  return { modes, pins };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// Hook: pure analysis of sketch source to detect pins, defines and pinMode(...) usage
export function useSketchAnalysis(code: string): SketchAnalysisResult {
  return useMemo(() => {
    const mainCode = code || "";

    const varMap = extractVarMap(mainCode);
    const pins = findAnalogReadPins(mainCode, varMap);
    for (const pin of findForLoopPins(mainCode)) pins.add(pin);
    const { modes: detectedModes, pins: pinModePins } =
      findPinModePins(mainCode);

    const overlap = Array.from(pins).filter((p) => pinModePins.has(p));

    return {
      analogPins: Array.from(pins).sort((a, b) => a - b),
      varMap: Object.fromEntries(varMap),
      detectedPinModes: detectedModes,
      pendingPinConflicts: overlap,
      digitalPinsFromPinMode: Array.from(pinModePins).sort((a, b) => a - b),
    };
  }, [code]);
}

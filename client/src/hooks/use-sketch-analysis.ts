import { useMemo } from "react";

type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

interface SketchAnalysisResult {
  analogPins: number[]; // concrete Arduino pin numbers (A0 -> 14)
  varMap: Record<string, number>;
  detectedPinModes: Record<number, PinMode>;
  pendingPinConflicts: number[]; // pins that are both used as analogRead and declared via pinMode
  digitalPinsFromPinMode: number[];
}

// Hook: pure analysis of sketch source to detect pins, defines and pinMode(...) usage
export function useSketchAnalysis(code: string): SketchAnalysisResult {
  return useMemo(() => {
    const mainCode = code || "";
    const pins = new Set<number>();
    const varMap = new Map<string, number>();

    // #define VAR A0  or #define VAR 0
    const defineRe = /#define\s+(\w+)\s+(A\d|\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = defineRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // variable assignments like: int sensorPin = A0; or const int s = 0;
    const assignRe = /(?:int|const\s+int|uint8_t|byte)\s+(\w+)\s*=\s*(A\d|\d+)\s*;/g;
    while ((m = assignRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // analogRead(...) occurrences
    const areadRe = /analogRead\s*\(\s*([^\)]+)\s*\)/g;
    while ((m = areadRe.exec(mainCode))) {
      const token = m[1].trim();
      const simple = token.match(/^(A\d+|\d+|\w+)$/i);
      if (!simple) continue;
      const tok = simple[1];

      const aMatch = tok.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        continue;
      }

      if (/^\d+$/.test(tok)) {
        const idx = Number(tok);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        else if (idx >= 14 && idx <= 19) pins.add(idx);
        continue;
      }

      if (varMap.has(tok)) {
        pins.add(varMap.get(tok)!);
      }
    }

    // for-loops that iterate a variable used in analogRead(...)
    const forLoopRe =
      /for\s*\(\s*(?:byte|int|unsigned|uint8_t)?\s*(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;[^\)]*\)\s*\{([\s\S]*?)\}/g;
    let fm: RegExpExecArray | null;
    while ((fm = forLoopRe.exec(mainCode))) {
      const varName = fm[1];
      const start = Number(fm[2]);
      const cmp = fm[3];
      const end = Number(fm[4]);
      const body = fm[5];
      const useRe = new RegExp("analogRead\\s*\\(\\s*" + varName + "\\s*\\)", "g");
      if (useRe.test(body)) {
        const inclusive = cmp === "<=";
        const last = inclusive ? end : end - 1;
        for (let pin = start; pin <= last; pin++) {
          if (pin >= 0 && pin <= 5) pins.add(14 + pin);
          else if (pin >= 14 && pin <= 19) pins.add(pin);
          else if (pin >= 16 && pin <= 19) pins.add(pin);
        }
      }
    }

    // pinMode(...) detection
    const pinModeRe = /pinMode\s*\(\s*(A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;
    const digitalPinsFromPinMode = new Set<number>();
    const detectedModes: Record<number, PinMode> = {};
    while ((m = pinModeRe.exec(mainCode))) {
      const token = m[1];
      const modeToken = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 255) p = idx;
      }
      if (p !== undefined) {
        digitalPinsFromPinMode.add(p);
        const mode =
          modeToken === "INPUT_PULLUP"
            ? "INPUT_PULLUP"
            : modeToken === "OUTPUT"
            ? "OUTPUT"
            : "INPUT";
        detectedModes[p] = mode;
      }
    }

    // find overlaps (conflicts): pins used with analogRead and also declared via pinMode(...)
    const overlap = Array.from(pins).filter((p) =>
      digitalPinsFromPinMode.has(p),
    );

    const clientPins = Array.from(pins).sort((a, b) => a - b);

    // Convert varMap to plain object
    const varObj: Record<string, number> = {};
    for (const [k, v] of varMap.entries()) varObj[k] = v;

    return {
      analogPins: clientPins,
      varMap: varObj,
      detectedPinModes: detectedModes,
      pendingPinConflicts: overlap,
      digitalPinsFromPinMode: Array.from(digitalPinsFromPinMode).sort(
        (a, b) => a - b,
      ),
    };
  }, [code]);
}

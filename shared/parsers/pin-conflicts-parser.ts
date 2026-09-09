import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  type StaticIOAnalysis,
  type StaticIOCall,
} from "@shared/io-registry-parser";

function compareDigitalCallOrder(
  a: { digitalCalls: StaticIOCall[] },
  b: { digitalCalls: StaticIOCall[] },
): number {
  const aPinModes = a.digitalCalls.filter(({ op }) => op === "pinMode");
  const bPinModes = b.digitalCalls.filter(({ op }) => op === "pinMode");
  if (aPinModes.length > 0 && bPinModes.length === 0) return -1;
  if (aPinModes.length === 0 && bPinModes.length > 0) return 1;

  const aCalls = aPinModes.length > 0 ? aPinModes : a.digitalCalls;
  const bCalls = bPinModes.length > 0 ? bPinModes : b.digitalCalls;
  return Math.min(...aCalls.map(({ line }) => line)) -
    Math.min(...bCalls.map(({ line }) => line));
}

function pinLabel(pinId: number): string {
  return pinId >= 14 ? `A${pinId - 14}` : String(pinId);
}

/**
 * Parser for pin conflicts (same pin used as digital and analog)
 * 
 * Rules:
 * 1. Digital + analog on same pin
 * 2. Multiple conflicts
 * 3. Numeric pin notation
 */
export class PinConflictsParser {
  constructor(private readonly analysis: StaticIOAnalysis) {}

  parse(): ParserMessage[] {
    return this.analysis.pins
      .map(({ pinId, calls }) => ({
        pinId,
        digitalCalls: calls.filter(({ op }) =>
          op === "pinMode" || op === "digitalRead" || op === "digitalWrite"
        ),
        analogCalls: calls.filter(({ op }) =>
          op === "analogRead" || op === "analogWrite"
        ),
      }))
      .filter(({ digitalCalls, analogCalls }) =>
        digitalCalls.length > 0 && analogCalls.length > 0
      )
      .sort(compareDigitalCallOrder)
      .map(({ pinId }) => ({
        id: randomUUID(),
        type: "warning" as const,
        category: "hardware" as const,
        severity: 2 as const,
        message: `Pin ${pinLabel(pinId)} used as both digital and analog. This may be unintended.`,
        suggestion: "// Use separate pins for digital and analog",
      }));
  }
}

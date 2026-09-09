import { useMemo } from "react";
import {
  analyzeStaticIO,
  type StaticIOCall,
} from "@shared/io-registry-parser";
import type { PinMode } from "@shared/types/arduino.types";

interface SketchAnalysisResult {
  analogPins: number[]; // concrete Arduino pin numbers (A0 -> 14)
  varMap: Record<string, number>;
  detectedPinModes: Record<number, PinMode>;
  pendingPinConflicts: number[]; // pins that are both used as analogRead and declared via pinMode
  digitalPinsFromPinMode: number[];
}

function toAnalogBoardPin(pinId: number): number | undefined {
  if (pinId >= 0 && pinId <= 5) return pinId + 14;
  if (pinId >= 14 && pinId <= 19) return pinId;
  return undefined;
}

function projectVarMap(symbols: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(symbols).flatMap(([name, pinId]) => {
      const analogPin = toAnalogBoardPin(pinId);
      return analogPin === undefined ? [] : [[name, analogPin]];
    }),
  );
}

function isVisibleAnalogRead(call: StaticIOCall): boolean {
  return call.op === "analogRead" && call.loopBody !== "braceless";
}

// Hook: pure projection of the canonical static I/O analysis for board state.
export function useSketchAnalysis(code: string): SketchAnalysisResult {
  return useMemo(() => {
    const analysis = analyzeStaticIO(code || "");
    const analogPins = new Set<number>();
    const pinModePins = new Set<number>();
    const detectedPinModes: Record<number, PinMode> = {};

    for (const { pinId, calls } of analysis.pins) {
      for (const call of calls) {
        if (isVisibleAnalogRead(call)) {
          const analogPin = toAnalogBoardPin(pinId);
          if (analogPin !== undefined) analogPins.add(analogPin);
        }
        if (call.op === "pinMode" && call.mode !== undefined) {
          pinModePins.add(pinId);
          detectedPinModes[pinId] = call.mode;
        }
      }
    }

    const sortedAnalogPins = [...analogPins].sort((a, b) => a - b);
    const sortedPinModePins = [...pinModePins].sort((a, b) => a - b);

    return {
      analogPins: sortedAnalogPins,
      varMap: projectVarMap(analysis.symbols),
      detectedPinModes,
      pendingPinConflicts: sortedAnalogPins.filter((pin) =>
        pinModePins.has(pin)
      ),
      digitalPinsFromPinMode: sortedPinModePins,
    };
  }, [code]);
}

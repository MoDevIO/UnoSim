import type { IOPinRecord } from "@shared/schema";
import { pinModeToString } from "@shared/utils/arduino-utils";

export type PinConflictInfo =
  | { conflict: true; conflictMessage: string }
  | { conflict: false };

/**
 * Ensures the pinMode operation is recorded in usedAt and avoids duplicates.
 * Returns true if a new entry was added.
 */
export function ensurePinModeOperation(pin: IOPinRecord, mode: number): boolean {
  const pinModeOp = `pinMode:${mode}`;
  if (!pin.usedAt) pin.usedAt = [];
  const alreadyTracked = pin.usedAt.some((u) => u.operation === pinModeOp);
  if (!alreadyTracked) {
    pin.usedAt.push({ line: 0, operation: pinModeOp });
    return true;
  }
  return false;
}

/**
 * Evaluates whether a pin has a conflict based on recorded operations.
 * Returns conflict info without mutating the passed pin.
 */
export function computePinConflict(pin: IOPinRecord): PinConflictInfo {
  const ops = pin.usedAt ?? [];
  const pinModeOps = ops.filter((u) => u.operation.startsWith("pinMode:"));
  const distinctModes = new Set(pinModeOps.map((u) => u.operation));

  if (distinctModes.size > 1) {
    const modeNames = Array.from(distinctModes).map((op) => {
      const n = Number.parseInt(op.split(":")[1], 10);
      return pinModeToString(n);
    });
    return {
      conflict: true,
      conflictMessage: `Multiple modes: ${modeNames.join(", ")}`,
    };
  }

  const hasInput = ops.some(
    (u) => u.operation === "pinMode:0" || u.operation === "pinMode:2",
  );
  const hasWrite = ops.some(
    (u) => u.operation === "digitalWrite" || u.operation === "analogWrite",
  );
  if (hasInput && hasWrite) {
    const inputModeName = ops.some((u) => u.operation === "pinMode:2")
      ? "INPUT_PULLUP"
      : "INPUT";
    return {
      conflict: true,
      conflictMessage: `Write on ${inputModeName} pin`,
    };
  }

  const hasOutput = ops.some((u) => u.operation === "pinMode:1");
  const hasRead = ops.some(
    (u) => u.operation === "digitalRead" || u.operation === "analogRead",
  );
  if (hasOutput && hasRead) {
    return { conflict: true, conflictMessage: "Read on OUTPUT pin" };
  }

  return { conflict: false };
}

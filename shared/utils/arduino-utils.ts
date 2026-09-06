import type { PinMode } from "../types/arduino.types";

const PIN_MODE_NAMES: Record<number, PinMode> = {
  0: "INPUT",
  1: "OUTPUT",
  2: "INPUT_PULLUP",
};

const PIN_MODE_VALUES: Record<PinMode, number> = {
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
};

export function pinModeToString(mode: number): PinMode {
  return PIN_MODE_NAMES[mode] ?? "INPUT"; // Default to INPUT for invalid modes
}

export function stringToPinMode(mode: string): number | undefined {
  return PIN_MODE_VALUES[mode as PinMode];
}

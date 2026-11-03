import type { PinMode } from "../types/arduino.types";

const PIN_MODE_NAMES: Record<number, PinMode> = {
  0: "INPUT",
  1: "OUTPUT",
  2: "INPUT_PULLUP",
};

export function pinModeToString(mode: number): PinMode {
  return PIN_MODE_NAMES[mode] ?? "INPUT"; // Default to INPUT for invalid modes
}

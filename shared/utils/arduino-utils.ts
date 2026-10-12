import type { PinMode } from "../types/arduino.types";

const PIN_MODE_NAMES: Record<number, PinMode> = {
  0: "INPUT",
  1: "OUTPUT",
  2: "INPUT_PULLUP",
};

export function pinModeToString(mode: number): PinMode {
  return PIN_MODE_NAMES[mode] ?? "INPUT"; // Default to INPUT for invalid modes
}

/**
 * PWM-capable digital pins of the Arduino UNO (the pins marked "~"), in board
 * order. The single definition of this hardware property: UI, polling engine
 * and hardware-compatibility checks all derive from it.
 */
export const UNO_PWM_PINS: readonly number[] = [3, 5, 6, 9, 10, 11];

const UNO_PWM_PIN_SET: ReadonlySet<number> = new Set(UNO_PWM_PINS);

export function isUnoPwmPin(pin: number): boolean {
  return UNO_PWM_PIN_SET.has(pin);
}

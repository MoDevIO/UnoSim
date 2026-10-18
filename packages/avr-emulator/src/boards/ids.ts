import type { McuId } from "../mcu/mcus";

/** Board hardware the emulator knows (plan 4.3); UnoSim's catalog maps its board IDs onto these. */
export const BOARD_HARDWARE_IDS = ["uno", "nano", "mega2560", "attiny85"] as const;
export type BoardHardwareId = (typeof BOARD_HARDWARE_IDS)[number];

export const BOARD_MCU: Readonly<Record<BoardHardwareId, McuId>> = {
  uno: "atmega328p",
  nano: "atmega328p",
  mega2560: "atmega2560",
  attiny85: "attiny85",
};

export function isBoardHardwareId(value: unknown): value is BoardHardwareId {
  return typeof value === "string" && (BOARD_HARDWARE_IDS as readonly string[]).includes(value);
}

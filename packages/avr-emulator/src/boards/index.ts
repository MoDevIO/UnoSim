/**
 * Entry `@unosim/avr-emulator/boards`: board ids and pin hardware only. It
 * imports no emulation code (no avr8js), so UnoSim's `shared/` and the client
 * can read the pin maps without pulling the emulator into their bundles.
 */
export { BOARD_HARDWARE_IDS, BOARD_MCU, isBoardHardwareId } from "./ids";
export type { BoardHardwareId } from "./ids";
export { NANO, UNO } from "./atmega328p-boards";
export { boardHardware, hasBoardHardware } from "./registry";
export type { BoardHardware, PinHardware, PortName, SerialPortHardware } from "./types";

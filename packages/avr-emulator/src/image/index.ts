/**
 * Entry `@unosim/avr-emulator/image`: building and validating the transportable
 * flash image (HEX, ELF symbols, SHA-256, Base64) without any emulation code
 * (no avr8js), so the server can build the `artifact` of a compile result.
 */
export { BOARD_HARDWARE_IDS, BOARD_MCU } from "../boards/ids";
export type { BoardHardwareId } from "../boards/ids";
export { MCU_FLASH_BYTES } from "../mcu/mcus";
export { decodeBase64, encodeBase64 } from "./base64";
export { ImageError } from "./image-error";
export {
  IO_FUNCTION_SYMBOLS,
  MEMORY_SYMBOLS,
  SIMULATION_IMAGE_FORMAT_VERSION,
  buildSimulationImage,
} from "./simulation-image";
export type { BuildImageInput, ImageSymbols, SimulationImage } from "./simulation-image";

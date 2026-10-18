/**
 * @unosim/avr-emulator – AVR emulation core of UnoSim.
 *
 * The package describes hardware only and imports nothing from UnoSim
 * (`client/`, `server/`, `shared/`); UnoSim's `shared/` may import it.
 */
export { BOARD_HARDWARE_IDS, BOARD_MCU, isBoardHardwareId } from "./boards/ids";
export type { BoardHardwareId } from "./boards/ids";
export { encodeBase64, decodeBase64 } from "./image/base64";
export { readElfSymbols } from "./image/elf";
export type { ElfSymbol } from "./image/elf";
export { ImageError } from "./image/image-error";
export { parseIntelHex } from "./image/intel-hex";
export type { IntelHexImage } from "./image/intel-hex";
export { sha256Hex } from "./image/sha256";
export {
  IO_FUNCTION_SYMBOLS,
  MEMORY_SYMBOLS,
  SIMULATION_IMAGE_FORMAT_VERSION,
  buildSimulationImage,
  loadSimulationImage,
} from "./image/simulation-image";
export type {
  BuildImageInput,
  ImageSymbols,
  IoFunctionSymbol,
  LoadedImage,
  MemorySymbol,
  SimulationImage,
} from "./image/simulation-image";
export { AVR8JS_DATA_SPACE_OFFSET, avr8jsSramParameter, ramEnd } from "./mcu/memory";
export type { MemoryLayout } from "./mcu/memory";
export { MCU_FLASH_BYTES, MCU_IDS } from "./mcu/mcus";
export type { McuId } from "./mcu/mcus";

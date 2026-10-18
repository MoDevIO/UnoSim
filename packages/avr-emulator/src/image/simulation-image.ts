import { BOARD_MCU, type BoardHardwareId, isBoardHardwareId } from "../boards/ids";
import { MCU_FLASH_BYTES, type McuId } from "../mcu/mcus";
import { decodeBase64, encodeBase64 } from "./base64";
import { type ElfSymbol, readElfSymbols } from "./elf";
import { ImageError } from "./image-error";
import { parseIntelHex } from "./intel-hex";
import { sha256Hex } from "./sha256";

/** Version of the serialized form; part of the build identity (plan E15). */
export const SIMULATION_IMAGE_FORMAT_VERSION = 1;

export const IO_FUNCTION_SYMBOLS = ["pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite"] as const;
export type IoFunctionSymbol = (typeof IO_FUNCTION_SYMBOLS)[number];
export const MEMORY_SYMBOLS = ["__data_end", "__bss_end", "_end", "__heap_start", "__brkval"] as const;
export type MemorySymbol = (typeof MEMORY_SYMBOLS)[number];

export interface ImageSymbols {
  /** Entry points as flash byte addresses; after LTO usually absent (spike P0.4). */
  readonly functions: Partial<Record<IoFunctionSymbol, number>>;
  /** Data-space addresses (without the ELF offset 0x800000). */
  readonly data: Partial<Record<MemorySymbol, number>>;
}

/**
 * A compiled sketch in transportable form; the field `artifact` of
 * `POST /api/compile` has exactly this shape (plan E5).
 */
export interface SimulationImage {
  readonly formatVersion: typeof SIMULATION_IMAGE_FORMAT_VERSION;
  readonly board: BoardHardwareId;
  /** Used flash range from address 0, Base64. */
  readonly flashBase64: string;
  readonly flashBytes: number;
  /** SHA-256 of the used flash range, lowercase hex. */
  readonly sha256: string;
  readonly symbols: ImageSymbols;
}

/** A validated image ready for a CPU. */
export interface LoadedImage {
  readonly board: BoardHardwareId;
  readonly mcu: McuId;
  /** Whole flash as words; bytes beyond the image read 0xFF like erased flash. */
  readonly progMem: Uint16Array;
  readonly flashBytes: number;
  readonly sha256: string;
  readonly symbols: ImageSymbols;
}

export interface BuildImageInput {
  readonly board: BoardHardwareId;
  /** Intel HEX from `arduino-cli` (`<sketch>.ino.hex`, without bootloader). */
  readonly hex: string;
  /** Matching ELF, optional; supplies the symbols. */
  readonly elf?: Uint8Array;
}

const ELF_DATA_OFFSET = 0x800000;
const ELF_DATA_END = 0x810000;

export function buildSimulationImage({ board, hex, elf }: BuildImageInput): SimulationImage {
  const mcu = BOARD_MCU[board];
  const { bytes } = parseIntelHex(hex, MCU_FLASH_BYTES[mcu]);
  if (bytes.length === 0) throw new ImageError("HEX file contains no data");
  return {
    formatVersion: SIMULATION_IMAGE_FORMAT_VERSION,
    board,
    flashBase64: encodeBase64(bytes),
    flashBytes: bytes.length,
    sha256: sha256Hex(bytes),
    symbols: elf ? pickSymbols(readElfSymbols(elf)) : { functions: {}, data: {} },
  };
}

/** Validates an image from an untrusted source (REST response, worker message) and expands its flash. */
export function loadSimulationImage(image: unknown): LoadedImage {
  if (typeof image !== "object" || image === null) throw new ImageError("image must be an object");
  const candidate = image as Record<string, unknown>;
  if (candidate.formatVersion !== SIMULATION_IMAGE_FORMAT_VERSION) {
    throw new ImageError(`unsupported image format ${String(candidate.formatVersion)}`);
  }
  if (!isBoardHardwareId(candidate.board)) throw new ImageError(`unknown board ${String(candidate.board)}`);
  if (typeof candidate.flashBase64 !== "string" || typeof candidate.sha256 !== "string") {
    throw new ImageError("image needs flashBase64 and sha256");
  }
  const mcu = BOARD_MCU[candidate.board];
  const flashSize = MCU_FLASH_BYTES[mcu];
  // Reject oversized input before decoding it.
  if (candidate.flashBase64.length > Math.ceil(flashSize / 3) * 4) throw new ImageError(`image exceeds the flash size of ${mcu}`);
  const bytes = decodeBase64(candidate.flashBase64);
  if (bytes.length === 0 || bytes.length !== candidate.flashBytes) throw new ImageError("flashBytes does not match the flash data");
  if (sha256Hex(bytes) !== candidate.sha256) throw new ImageError("SHA-256 does not match the flash data");

  const flash = new Uint8Array(flashSize).fill(0xff);
  flash.set(bytes);
  return {
    board: candidate.board,
    mcu,
    progMem: new Uint16Array(flash.buffer),
    flashBytes: bytes.length,
    sha256: candidate.sha256,
    symbols: validateSymbols(candidate.symbols, flashSize),
  };
}

function pickSymbols(symbols: ReadonlyMap<string, ElfSymbol>): ImageSymbols {
  const functions: Partial<Record<IoFunctionSymbol, number>> = {};
  for (const name of IO_FUNCTION_SYMBOLS) {
    const symbol = symbols.get(name);
    if (symbol?.kind === "function") functions[name] = symbol.value;
  }
  const data: Partial<Record<MemorySymbol, number>> = {};
  for (const name of MEMORY_SYMBOLS) {
    const symbol = symbols.get(name);
    if (symbol && symbol.value >= ELF_DATA_OFFSET && symbol.value < ELF_DATA_END) data[name] = symbol.value - ELF_DATA_OFFSET;
  }
  return { functions, data };
}

function validateSymbols(value: unknown, flashSize: number): ImageSymbols {
  const symbols = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    functions: pickNumbers(symbols.functions, IO_FUNCTION_SYMBOLS, flashSize),
    data: pickNumbers(symbols.data, MEMORY_SYMBOLS, ELF_DATA_END - ELF_DATA_OFFSET),
  };
}

function pickNumbers<K extends string>(value: unknown, keys: readonly K[], limit: number): Partial<Record<K, number>> {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const entry = source[key];
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && entry < limit) out[key] = entry;
  }
  return out;
}

import { ImageError } from "./image-error";

export interface IntelHexImage {
  /** Bytes from address 0 to the end of the highest data record; gaps read 0xFF like erased flash. */
  readonly bytes: Uint8Array;
  /** Record types that occurred, sorted. */
  readonly recordTypes: readonly number[];
}

const DATA = 0x00;
const END_OF_FILE = 0x01;
const EXTENDED_SEGMENT_ADDRESS = 0x02;
const START_SEGMENT_ADDRESS = 0x03;
const EXTENDED_LINEAR_ADDRESS = 0x04;
const START_LINEAR_ADDRESS = 0x05;
const ERASED = 0xff;

/**
 * Parses Intel HEX as avr-objcopy writes it (record types 00–05).
 * Rejects bad syntax, checksums and data beyond `maxBytes`.
 */
export function parseIntelHex(text: string, maxBytes: number): IntelHexImage {
  const flash = new Uint8Array(maxBytes).fill(ERASED);
  const types = new Set<number>();
  let base = 0;
  let end = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && !sawEof; index++) {
    const line = lines[index].trim();
    if (line === "") continue;
    const record = decodeRecord(line, index + 1);
    types.add(record.type);
    switch (record.type) {
      case DATA: {
        const address = base + record.address;
        if (address + record.data.length > maxBytes) {
          throw new ImageError(`line ${index + 1}: data at 0x${address.toString(16)} exceeds the flash size of ${maxBytes} bytes`);
        }
        flash.set(record.data, address);
        end = Math.max(end, address + record.data.length);
        break;
      }
      case END_OF_FILE:
        sawEof = true;
        break;
      case EXTENDED_SEGMENT_ADDRESS:
        base = readAddressField(record.data, index + 1) << 4;
        break;
      case EXTENDED_LINEAR_ADDRESS:
        base = readAddressField(record.data, index + 1) << 16;
        break;
      case START_SEGMENT_ADDRESS:
      case START_LINEAR_ADDRESS:
        break; // entry point; AVR always starts at the reset vector
      default:
        throw new ImageError(`line ${index + 1}: unknown record type ${record.type}`);
    }
  }
  if (!sawEof) throw new ImageError("missing end-of-file record");
  return { bytes: flash.slice(0, end), recordTypes: [...types].sort((a, b) => a - b) };
}

interface HexRecord {
  readonly type: number;
  readonly address: number;
  readonly data: Uint8Array;
}

function decodeRecord(line: string, lineNumber: number): HexRecord {
  if (!line.startsWith(":") || line.length < 11 || line.length % 2 === 0 || !/^:[0-9A-Fa-f]+$/.test(line)) {
    throw new ImageError(`line ${lineNumber}: not an Intel HEX record`);
  }
  const bytes = new Uint8Array((line.length - 1) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(line.slice(1 + i * 2, 3 + i * 2), 16);
  const count = bytes[0];
  if (bytes.length !== count + 5) throw new ImageError(`line ${lineNumber}: length does not match the byte count`);
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  if (sum !== 0) throw new ImageError(`line ${lineNumber}: checksum mismatch`);
  return { type: bytes[3], address: (bytes[1] << 8) | bytes[2], data: bytes.subarray(4, 4 + count) };
}

function readAddressField(data: Uint8Array, lineNumber: number): number {
  if (data.length !== 2) throw new ImageError(`line ${lineNumber}: address record needs 2 data bytes`);
  return (data[0] << 8) | data[1];
}

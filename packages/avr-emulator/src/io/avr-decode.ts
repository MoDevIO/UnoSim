/**
 * Minimal AVR instruction decoding for the I/O observation (spike P0.4):
 * which bit an I/O access touches when the register value alone does not
 * tell.
 */

/** Bit of an SBI, CBI, SBIS or SBIC opcode, else undefined. */
export function ioBitInstructionBit(opcode: number): number | undefined {
  const high = opcode & 0xff00;
  return high === 0x9a00 || high === 0x9800 || high === 0x9b00 || high === 0x9900 ? opcode & 7 : undefined;
}

/** True for SBI (sets the bit); false for CBI, SBIS, SBIC. */
export const isSetBitInstruction = (opcode: number): boolean => (opcode & 0xff00) === 0x9a00;

/** Destination register of IN, LDS, LD X/Y/Z or LDD, else undefined. */
export function loadDestination(opcode: number): number | undefined {
  if ((opcode & 0xf800) === 0xb000 || (opcode & 0xfe00) === 0x9000 || (opcode & 0xd200) === 0x8000) return (opcode & 0x1f0) >> 4;
  return undefined;
}

/** Source register of OUT, STS, ST X/Y/Z or STD, else undefined. */
export function storeSource(opcode: number): number | undefined {
  if ((opcode & 0xf800) === 0xb800 || (opcode & 0xfe00) === 0x9200 || (opcode & 0xd200) === 0x8200) return (opcode & 0x1f0) >> 4;
  return undefined;
}

export const isTwoWordInstruction = (opcode: number): boolean =>
  (opcode & 0xfe0f) === 0x9000 || (opcode & 0xfe0f) === 0x9200 || (opcode & 0xfe0e) === 0x940e || (opcode & 0xfe0e) === 0x940c;

export interface BitMask {
  readonly set: number;
  readonly clear: number;
}

/** Mask that ORI/OR (set) or ANDI/AND (clear) apply to `register`, else undefined. */
export function modifierMask(opcode: number, register: number, data: Uint8Array): BitMask | undefined {
  const immediate = (opcode & 0xf) | ((opcode & 0xf00) >> 4);
  const immediateRegister = ((opcode & 0xf0) >> 4) + 16;
  if ((opcode & 0xf000) === 0x6000 && immediateRegister === register) return { set: immediate, clear: 0 }; // ORI
  if ((opcode & 0xf000) === 0x7000 && immediateRegister === register) return { set: 0, clear: ~immediate & 0xff }; // ANDI
  const d = (opcode & 0x1f0) >> 4;
  const r = (opcode & 0xf) | ((opcode & 0x200) >> 5);
  if (d !== register && r !== register) return undefined;
  const other = data[d === register ? r : d];
  if ((opcode & 0xfc00) === 0x2800) return { set: other, clear: 0 }; // OR
  if ((opcode & 0xfc00) === 0x2000) return { set: 0, clear: ~other & 0xff }; // AND
  return undefined;
}

/** Bit tested by SBRC/SBRS on `register`, else undefined. */
export function skipBitTest(opcode: number, register: number): number | undefined {
  return (opcode & 0xfc08) === 0xfc00 && ((opcode & 0x1f0) >> 4) === register ? opcode & 7 : undefined;
}

export const bitsOf = (mask: number): number[] => [0, 1, 2, 3, 4, 5, 6, 7].filter((bit) => mask & (1 << bit));

/** The single bit of a mask, or undefined when it has none or several. */
export function singleBit(mask: number): number | undefined {
  const bits = bitsOf(mask);
  return bits.length === 1 ? bits[0] : undefined;
}

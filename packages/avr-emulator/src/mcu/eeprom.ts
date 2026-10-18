import type { EEPROMBackend } from "avr8js";

/** EEPROM backed by a caller-owned array, so its content survives a reset and later runs (plan 4.8). */
export class ArrayEepromBackend implements EEPROMBackend {
  constructor(private readonly memory: Uint8Array) {}

  readMemory(address: number): number {
    return this.memory[address] ?? 0xff;
  }

  writeMemory(address: number, value: number): void {
    // An EEPROM write can only clear bits; erasing sets them (datasheet "Atomic Byte Programming").
    if (address < this.memory.length) this.memory[address] &= value;
  }

  eraseMemory(address: number): void {
    if (address < this.memory.length) this.memory[address] = 0xff;
  }
}

/** Fresh EEPROM content: every byte erased (0xFF). */
export function erasedEeprom(bytes: number): Uint8Array {
  return new Uint8Array(bytes).fill(0xff);
}

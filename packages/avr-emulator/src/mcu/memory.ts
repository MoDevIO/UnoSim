/**
 * Data-space layout of an AVR MCU as avr8js needs it.
 *
 * avr8js has a single size parameter: `new CPU(progMem, sramBytes)` allocates
 * `sramBytes + 0x100` bytes of data space and puts SP on its last byte at
 * reset. That parameter is therefore not the SRAM size of the chip; profiles
 * derive it from RAMEND and never rely on the default (8192).
 */
export interface MemoryLayout {
  /** First SRAM address in the data space (ATmega328P 0x100, ATmega2560 0x200, ATtiny85 0x60). */
  readonly sramStart: number;
  /** SRAM size from the datasheet. */
  readonly sramBytes: number;
}

/** Data space that avr8js adds on top of its size parameter. */
export const AVR8JS_DATA_SPACE_OFFSET = 0x100;

/** Last SRAM address, the value of RAMEND in avr-libc. */
export function ramEnd(layout: MemoryLayout): number {
  assertLayout(layout);
  return layout.sramStart + layout.sramBytes - 1;
}

/** Size parameter for `new CPU(progMem, …)` so that the data space ends at RAMEND. */
export function avr8jsSramParameter(layout: MemoryLayout): number {
  const parameter = ramEnd(layout) + 1 - AVR8JS_DATA_SPACE_OFFSET;
  if (parameter <= 0) {
    throw new RangeError(`data space up to 0x${ramEnd(layout).toString(16)} is too small for avr8js`);
  }
  return parameter;
}

function assertLayout({ sramStart, sramBytes }: MemoryLayout): void {
  if (!Number.isInteger(sramStart) || sramStart < 0) {
    throw new RangeError(`invalid SRAM start: ${sramStart}`);
  }
  if (!Number.isInteger(sramBytes) || sramBytes <= 0) {
    throw new RangeError(`invalid SRAM size: ${sramBytes}`);
  }
}

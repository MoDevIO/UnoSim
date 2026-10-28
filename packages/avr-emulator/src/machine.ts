import { CPU } from "avr8js";
import { boardHardware } from "./boards/registry";
import type { BoardHardware } from "./boards/types";
import type { LoadedImage } from "./image/simulation-image";
import { erasedEeprom } from "./mcu/eeprom";
import { avr8jsSramParameter } from "./mcu/memory";
import { mcuProfile } from "./mcu/registry";
import type { McuPeripherals, McuProfile } from "./mcu/types";

/** A CPU with the peripherals of its MCU and the pin map of its board. */
export interface Machine {
  readonly cpu: CPU;
  readonly board: BoardHardware;
  readonly mcu: McuProfile;
  readonly peripherals: McuPeripherals;
  /** EEPROM content, read and written in place by the running sketch. */
  readonly eeprom: Uint8Array;
}

export interface MachineOptions {
  /** EEPROM content to start with (copied); erased when omitted. */
  readonly eeprom?: Uint8Array;
}

export function createMachine(image: LoadedImage, options: MachineOptions = {}): Machine {
  const board = boardHardware(image.board);
  const mcu = mcuProfile(board.mcu);
  if (image.progMem.length * 2 !== mcu.flashBytes) {
    throw new RangeError(`image has ${image.progMem.length * 2} bytes of flash, ${mcu.id} has ${mcu.flashBytes}`);
  }
  if (options.eeprom && options.eeprom.length !== mcu.eepromBytes) {
    throw new RangeError(`EEPROM content has ${options.eeprom.length} bytes, ${mcu.id} has ${mcu.eepromBytes}`);
  }
  const eeprom = options.eeprom ? options.eeprom.slice() : erasedEeprom(mcu.eepromBytes);
  const cpu = new CPU(image.progMem, avr8jsSramParameter(mcu.memory));
  return { cpu, board, mcu, peripherals: mcu.createPeripherals(cpu, board.clockHz, eeprom), eeprom };
}

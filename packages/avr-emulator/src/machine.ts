import { CPU } from "avr8js";
import { boardHardware } from "./boards/registry";
import type { BoardHardware } from "./boards/types";
import type { LoadedImage } from "./image/simulation-image";
import { avr8jsSramParameter } from "./mcu/memory";
import { mcuProfile } from "./mcu/registry";
import type { McuPeripherals, McuProfile } from "./mcu/types";

/** A CPU with the peripherals of its MCU and the pin map of its board. */
export interface Machine {
  readonly cpu: CPU;
  readonly board: BoardHardware;
  readonly mcu: McuProfile;
  readonly peripherals: McuPeripherals;
}

export function createMachine(image: LoadedImage): Machine {
  const board = boardHardware(image.board);
  const mcu = mcuProfile(board.mcu);
  if (image.progMem.length * 2 !== mcu.flashBytes) {
    throw new RangeError(`image has ${image.progMem.length * 2} bytes of flash, ${mcu.id} has ${mcu.flashBytes}`);
  }
  const cpu = new CPU(image.progMem, avr8jsSramParameter(mcu.memory));
  return { cpu, board, mcu, peripherals: mcu.createPeripherals(cpu, board.clockHz) };
}

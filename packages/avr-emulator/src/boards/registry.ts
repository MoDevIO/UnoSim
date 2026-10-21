import { UNO, NANO } from "./atmega328p-boards";
import { MEGA2560 } from "./mega2560-board";
import type { BoardHardwareId } from "./ids";
import type { BoardHardware } from "./types";

/** Board hardware with an MCU profile. ATtiny85 (P6.4) follows. */
const BOARDS: Partial<Record<BoardHardwareId, BoardHardware>> = { uno: UNO, nano: NANO, mega2560: MEGA2560 };

export function boardHardware(id: BoardHardwareId): BoardHardware {
  const board = BOARDS[id];
  if (!board) throw new RangeError(`board ${id} has no hardware profile yet`);
  return board;
}

export function hasBoardHardware(id: BoardHardwareId): boolean {
  return BOARDS[id] !== undefined;
}

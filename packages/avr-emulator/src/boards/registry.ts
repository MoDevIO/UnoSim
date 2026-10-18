import { UNO, NANO } from "./atmega328p-boards";
import type { BoardHardwareId } from "./ids";
import type { BoardHardware } from "./types";

/** Board hardware with an MCU profile. Mega 2560 (P5.2) and ATtiny85 (P6.4) follow. */
const BOARDS: Partial<Record<BoardHardwareId, BoardHardware>> = { uno: UNO, nano: NANO };

export function boardHardware(id: BoardHardwareId): BoardHardware {
  const board = BOARDS[id];
  if (!board) throw new RangeError(`board ${id} has no hardware profile yet`);
  return board;
}

export function hasBoardHardware(id: BoardHardwareId): boolean {
  return BOARDS[id] !== undefined;
}

import { z } from "zod";
import { BOARD_MCU, boardHardware, hasBoardHardware } from "@unosim/avr-emulator/boards";

/**
 * Board catalog of UnoSim (plan 4.3, P2.1): the product side of a board. The
 * emulation package describes the hardware (pins, MCU, clock); the catalog
 * adds name, FQBN, core, offered runtimes and release status.
 */
export const BOARD_IDS = ["uno", "nano", "mega2560", "attiny85"] as const;
export type BoardId = (typeof BOARD_IDS)[number];
export const boardIdSchema = z.enum(BOARD_IDS);

// Every catalog id is a board of the emulation package: `boardPinAliases` hands a `BoardId` to a
// function that takes a `BoardHardwareId`, which compiles only if the first is a subset. The test
// `tests/shared/boards.test.ts` checks the other direction.

export const RUNTIME_KINDS = ["browser", "host-mock"] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

/** `planned`: in the catalog and the types only; `preview`: selectable with a notice; `available`: reviewed and used in teaching. */
export const BOARD_STATUSES = ["planned", "preview", "available"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export interface BoardCatalogEntry {
  readonly id: BoardId;
  readonly displayName: string;
  readonly fqbn: string;
  readonly core: { readonly id: string; readonly version: string };
  readonly runtimes: readonly RuntimeKind[];
  readonly status: BoardStatus;
}

const AVR_CORE = { id: "arduino:avr", version: "1.8.8" } as const;

export const BOARD_CATALOG: readonly BoardCatalogEntry[] = [
  { id: "uno", displayName: "Arduino UNO", fqbn: "arduino:avr:uno", core: AVR_CORE, runtimes: ["browser", "host-mock"], status: "planned" },
  { id: "nano", displayName: "Arduino Nano", fqbn: "arduino:avr:nano:cpu=atmega328", core: AVR_CORE, runtimes: ["browser"], status: "planned" },
  { id: "mega2560", displayName: "Arduino Mega 2560", fqbn: "arduino:avr:mega:cpu=atmega2560", core: AVR_CORE, runtimes: ["browser"], status: "planned" },
  {
    id: "attiny85",
    displayName: "ATtiny85",
    fqbn: "ATTinyCore:avr:attinyx5:chip=85,clock=8internal",
    core: { id: "ATTinyCore:avr", version: "1.5.2" },
    runtimes: ["browser"],
    status: "planned",
  },
];

/** The board every request without a board means: the Uno of today. */
export const DEFAULT_BOARD_ID: BoardId = "uno";

export function getBoard(id: BoardId): BoardCatalogEntry {
  const entry = BOARD_CATALOG.find((board) => board.id === id);
  if (!entry) throw new RangeError(`board ${id} is not in the catalog`);
  return entry;
}

export function findBoardByFqbn(fqbn: string): BoardCatalogEntry | undefined {
  return BOARD_CATALOG.find((board) => board.fqbn === fqbn);
}

/**
 * The boards a deployment offers: the requested ids, or by default every board
 * with status `preview` or `available`; the default board is always included,
 * because requests without a board mean it.
 */
export function enabledBoards(requested?: readonly BoardId[], defaultBoard: BoardId = DEFAULT_BOARD_ID): BoardCatalogEntry[] {
  const wanted = new Set<BoardId>(requested ?? BOARD_CATALOG.filter((board) => board.status !== "planned").map((board) => board.id));
  wanted.add(defaultBoard);
  return BOARD_CATALOG.filter((board) => wanted.has(board.id));
}

/** The FQBNs `arduino-cli compile` may receive: exactly those of the given catalog entries. */
export function fqbnAllowlist(entries: readonly BoardCatalogEntry[] = BOARD_CATALOG): string[] {
  return entries.map((board) => board.fqbn);
}

/**
 * Sizes in bytes of the C++ types on every AVR board of the catalog (avr-gcc
 * ABI: `int` has 16 bit, `double` is the 32-bit `float`, pointers have 16 bit).
 */
export const AVR_DATA_TYPE_BYTES = { char: 1, short: 2, int: 2, long: 4, longLong: 8, float: 4, double: 4, pointer: 2 } as const;

/** What the Tutor's deterministic context says about the board a sketch is written for (plan P2.7). */
export function boardTutorFacts(id: BoardId): { id: BoardId; displayName: string; mcu: string; dataTypeBytes: typeof AVR_DATA_TYPE_BYTES } {
  return { id, displayName: getBoard(id).displayName, mcu: BOARD_MCU[id], dataTypeBytes: AVR_DATA_TYPE_BYTES };
}

/**
 * Pin names the sketch parsers resolve for a board (`A0` → 14, `LED_BUILTIN`),
 * taken from the pin map of the emulation package. Boards without hardware
 * profile yet (Mega 2560 and ATtiny85 until P5.1 and P6.2) have none.
 */
export function boardPinAliases(id: BoardId): Readonly<Record<string, number>> | undefined {
  if (!hasBoardHardware(id)) return undefined;
  const hardware = boardHardware(id);
  const aliases: Record<string, number> = { LED_BUILTIN: hardware.ledBuiltin };
  for (const pin of hardware.pins) if (/^A\d+$/.test(pin.label)) aliases[pin.label] = pin.pin;
  return aliases;
}

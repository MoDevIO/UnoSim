import { boardHardware, hasBoardHardware, type PinHardware } from "@unosim/avr-emulator/boards";
import type { BoardId } from "./boards";

/**
 * The pins of a board as the UI, the sketch parsers and the input checks see
 * them (plan 4.3, P4.1): derived from the pin map of the emulation package, the
 * single definition of the hardware. A board without a hardware profile has
 * none.
 */
export interface BoardPin {
  /** Arduino pin number of the core (Uno: A0 = 14). */
  readonly pin: number;
  /** `D13`, `A0`: how the board names it. */
  readonly label: string;
  /** The name a sketch writes: `13`, `A0`; for a digital pin with an analog second name (ATtiny85 `2`/`A1`) its number. */
  readonly name: string;
  /** The analog second name of a digital pin (ATtiny85: `A1` for pin 2). */
  readonly analogName?: string;
  /** Usable as a digital pin: it has a port bit (A6/A7 of the Nano have none). */
  readonly digital: boolean;
  /** Has an ADC channel. */
  readonly analog: boolean;
  readonly adcChannel?: number;
  readonly pwm: boolean;
  readonly role?: PinHardware["role"];
}

const cache = new Map<BoardId, readonly BoardPin[]>();

function toBoardPin(pin: PinHardware): BoardPin {
  const analog = pin.adcChannel !== undefined;
  return {
    pin: pin.pin,
    label: pin.label,
    name: analog && !pin.analogName ? pin.label : String(pin.pin),
    ...(pin.analogName ? { analogName: pin.analogName } : {}),
    digital: pin.port !== undefined,
    analog,
    ...(pin.adcChannel === undefined ? {} : { adcChannel: pin.adcChannel }),
    pwm: pin.pwm !== undefined,
    ...(pin.role ? { role: pin.role } : {}),
  };
}

/** All pins of the board in number order; `undefined` while the board has no hardware profile. */
export function boardPins(board: BoardId): readonly BoardPin[] | undefined {
  if (!hasBoardHardware(board)) return undefined;
  let pins = cache.get(board);
  if (!pins) {
    pins = boardHardware(board).pins.map(toBoardPin).sort((a, b) => a.pin - b.pin);
    cache.set(board, pins);
  }
  return pins;
}

export function findBoardPin(board: BoardId, pin: number): BoardPin | undefined {
  return boardPins(board)?.find((candidate) => candidate.pin === pin);
}

/** True if the board has this pin number (checked by the input of pin values, plan P4.7). */
export const isBoardPin = (board: BoardId, pin: number): boolean => findBoardPin(board, pin) !== undefined;

/** PWM-capable pins in board order (the pins marked "~"). */
export function boardPwmPins(board: BoardId): readonly number[] {
  return (boardPins(board) ?? []).filter((pin) => pin.pwm).map((pin) => pin.pin);
}

/** Analog inputs (`A0`…) in board order. */
export function boardAnalogPins(board: BoardId): readonly BoardPin[] {
  return (boardPins(board) ?? []).filter((pin) => pin.analog);
}

/** The label of a pin number (`14` → `A0`); an unknown pin keeps its number. */
export function boardPinLabel(board: BoardId, pin: number): string {
  const found = findBoardPin(board, pin);
  return found ? found.name : String(pin);
}

/**
 * The pin number a sketch means by `name`: a number (`13`), an analog name
 * (`A0`) or `LED_BUILTIN`; `undefined` if the board has no such pin.
 */
export function resolveBoardPin(board: BoardId, name: string): number | undefined {
  const pins = boardPins(board);
  if (!pins) return undefined;
  if (name === "LED_BUILTIN") return boardHardware(board).ledBuiltin;
  if (/^\d+$/.test(name)) {
    const pin = Number(name);
    return pins.some((candidate) => candidate.pin === pin) ? pin : undefined;
  }
  const analog = name.toUpperCase();
  return pins.find((candidate) => candidate.analog && (candidate.analogName ?? candidate.label) === analog)?.pin;
}

/** Number of hardware serial ports (`Serial`, `Serial1`, …); a board without hardware profile counts as the Uno with one. */
export const boardSerialPortCount = (board: BoardId): number => (hasBoardHardware(board) ? boardHardware(board).serialPorts.length : 1);

/** Highest pin number of the board; the host mock keeps its own limit of 19 (WebSocket boundary). */
export function maxBoardPin(board: BoardId): number | undefined {
  const pins = boardPins(board);
  return pins && pins.length > 0 ? Math.max(...pins.map((pin) => pin.pin)) : undefined;
}

import { boardHardware, hasBoardHardware } from "@unosim/avr-emulator/boards";
import { boardAnalogPins, boardPins, findBoardPin } from "../board-pins";
import { type BoardId, DEFAULT_BOARD_ID, getBoard } from "../boards";

/**
 * What the sketch parsers need to know about a board's pins (plan P4.2): which
 * pin numbers exist, what `A0`…`An` and `LED_BUILTIN` mean, how a pin is
 * written, which pins can do PWM, and which pins have no digital function.
 * Built from the pin model of the board (`board-pins`); a board without a
 * hardware profile yet is parsed like the Uno.
 */
export interface PinContext {
  readonly board: BoardId;
  readonly displayName: string;
  /** Highest pin number. */
  readonly maxPin: number;
  has(pin: number): boolean;
  /** Pin number of analog input `A<channel>`; `undefined` if the board has no such input. */
  analogPin(channel: number): number | undefined;
  /** `13`, `A0`: how a sketch writes the pin. */
  label(pin: number): string;
  /** Names the parsers resolve without a definition: `LED_BUILTIN`, `A0`… */
  builtinConstants(): Record<string, number>;
  pwmPins(): readonly number[];
  /** True for inputs without a digital function (A6 and A7 of the Nano). */
  analogOnly(pin: number): boolean;
  /** Number of hardware serial ports (`Serial`, `Serial1`, …). */
  serialPortCount(): number;
}

const cache = new Map<BoardId, PinContext>();

function createContext(board: BoardId): PinContext {
  const pins = boardPins(board) ?? [];
  const known = new Set(pins.map((pin) => pin.pin));
  const analog = boardAnalogPins(board);
  const channelPin = new Map(analog.map((pin) => [pin.adcChannel as number, pin.pin]));
  return {
    board,
    displayName: getBoard(board).displayName,
    maxPin: Math.max(...known),
    has: (pin) => known.has(pin),
    analogPin: (channel) => channelPin.get(channel),
    label: (pin) => findBoardPin(board, pin)?.name ?? String(pin),
    builtinConstants: () => ({
      LED_BUILTIN: boardHardware(board).ledBuiltin,
      ...Object.fromEntries(analog.map((pin) => [pin.label, pin.pin])),
    }),
    pwmPins: () => pins.filter((pin) => pin.pwm).map((pin) => pin.pin),
    analogOnly: (pin) => findBoardPin(board, pin)?.digital === false,
    serialPortCount: () => boardHardware(board).serialPorts.length,
  };
}

/** The pin context of a board; boards without hardware profile get the Uno's. */
export function pinContext(board: BoardId = DEFAULT_BOARD_ID): PinContext {
  const effective = hasBoardHardware(board) ? board : DEFAULT_BOARD_ID;
  let context = cache.get(effective);
  if (!context) {
    context = createContext(effective);
    cache.set(effective, context);
  }
  return context;
}

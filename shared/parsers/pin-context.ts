import { boardHardware, hasBoardHardware } from "@unosim/avr-emulator/boards";
import { boardAnalogPins, boardPins, findBoardPin } from "../board-pins";
import { type BoardId, DEFAULT_BOARD_ID, getBoard } from "../boards";

/**
 * What the sketch parsers need to know about a board's pins (plan P4.2): which
 * pin numbers exist, what `A0`…`An` and `LED_BUILTIN` mean, how a pin is
 * written, which pins can do PWM, and which pins have no digital function.
 * Built from the pin model of the board (`board-pins`); a board without a
 * hardware profile is parsed like the Uno.
 */
export interface PinContext {
  readonly board: BoardId;
  readonly displayName: string;
  /** Highest pin number. */
  readonly maxPin: number;
  has(pin: number): boolean;
  /** Pin number of analog input `A<channel>`; `undefined` if the board has no such input. */
  analogPin(channel: number): number | undefined;
  /**
   * The value of `A<channel>` in the core: the pin number (Uno: A0 = 14), or
   * `0x80 | channel` where the analog names are second names of digital pins
   * (ATtiny85, ATTinyCore).
   */
  analogValue(channel: number): number | undefined;
  /** True if `value` names a pin of the board, directly or as an analog value. */
  isPinValue(value: number): boolean;
  /**
   * The pin a call means by `value`, as the core reads it: a value with bit 7
   * set is an analog channel, `analogRead(n)` takes a channel where the board
   * has one; `undefined` for a value without a pin.
   */
  callPin(value: number, op: string): number | undefined;
  /** `13`, `A0`: how a sketch writes the pin. */
  label(pin: number): string;
  /** Names the parsers resolve without a definition: `LED_BUILTIN`, `A0`… */
  builtinConstants(): Record<string, number>;
  pwmPins(): readonly number[];
  /** True for inputs without a digital function (A6 and A7 of the Nano). */
  analogOnly(pin: number): boolean;
  /** Number of hardware serial ports (`Serial`, `Serial1`, …). */
  serialPortCount(): number;
  /** `reset` for a pin the board reserves for RESET (ATtiny85 PB5), `serial` for the pins of `Serial`. */
  role(pin: number): "reset" | "serial" | undefined;
  /** TX and RX of `Serial` when the core implements it in software on ordinary pins (ATtiny85). */
  softwareSerialPins(): { readonly tx: number; readonly rx: number } | undefined;
}

const cache = new Map<BoardId, PinContext>();

function createContext(board: BoardId): PinContext {
  const pins = boardPins(board) ?? [];
  const known = new Set(pins.map((pin) => pin.pin));
  const analog = boardAnalogPins(board);
  const channelPin = new Map(analog.map((pin) => [pin.adcChannel as number, pin.pin]));
  const encodedAnalog = analog.some((pin) => pin.analogName !== undefined);
  const decode = (value: number) => (encodedAnalog && value & 0x80 ? channelPin.get(value & 0x7f) : undefined);
  const analogValue = (channel: number) => (channelPin.has(channel) ? (encodedAnalog ? 0x80 | channel : channelPin.get(channel)) : undefined);
  return {
    board,
    displayName: getBoard(board).displayName,
    maxPin: Math.max(...known),
    has: (pin) => known.has(pin),
    analogPin: (channel) => channelPin.get(channel),
    analogValue,
    isPinValue: (value) => known.has(value) || decode(value) !== undefined,
    callPin: (value, op) => {
      const pin = decode(value) ?? (op === "analogRead" ? (channelPin.get(value) ?? value) : value);
      return known.has(pin) ? pin : undefined;
    },
    label: (pin) => findBoardPin(board, pin)?.name ?? String(pin),
    builtinConstants: () => ({
      LED_BUILTIN: boardHardware(board).ledBuiltin,
      ...Object.fromEntries(analog.map((pin) => [pin.analogName ?? pin.label, analogValue(pin.adcChannel as number) as number])),
    }),
    pwmPins: () => pins.filter((pin) => pin.pwm).map((pin) => pin.pin),
    analogOnly: (pin) => findBoardPin(board, pin)?.digital === false,
    serialPortCount: () => boardHardware(board).serialPorts.length,
    role: (pin) => findBoardPin(board, pin)?.role,
    softwareSerialPins: () => {
      const port = boardHardware(board).serialPorts.find((candidate) => candidate.kind === "software");
      return port ? { tx: port.txPin, rx: port.rxPin } : undefined;
    },
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

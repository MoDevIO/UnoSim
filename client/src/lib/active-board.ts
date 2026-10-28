import { boardAnalogPins, boardPins, boardPwmPins, boardPinLabel, findBoardPin, resolveBoardPin, type BoardPin } from "@shared/board-pins";
import { type BoardId, DEFAULT_BOARD_ID } from "@shared/boards";

/**
 * The board whose pins the pin state, the registry table and the sketch analysis talk about
 * (plan P4.3). The page sets it from Tools → Board; helpers without access to the page state
 * (the pin store, label functions) read it here. Until a board is set it is the Uno.
 */
let active: BoardId = DEFAULT_BOARD_ID;

export const getActiveBoard = (): BoardId => active;

export function setActiveBoard(board: BoardId): void {
  active = board;
}

/** Every pin of the active board in number order (the Uno's when the board has no hardware profile yet). */
export const activePins = (): readonly BoardPin[] => boardPins(active) ?? boardPins(DEFAULT_BOARD_ID) ?? [];

const hardwareBoard = (): BoardId => (boardPins(active) ? active : DEFAULT_BOARD_ID);

/** True for an analog input of the active board (`A0`…): pins 14–19 on the Uno, 14–21 on the Nano. */
export const isAnalogPin = (pin: number): boolean => findBoardPin(hardwareBoard(), pin)?.analog === true;

/** `13`, `A0`: how a sketch writes the pin on the active board. */
export const activePinLabel = (pin: number): string => boardPinLabel(hardwareBoard(), pin);

/** The name and, where it is a second name (ATtiny85), the analog name: `2 (A1)`; else as `activePinLabel`. */
export const activeAnalogPinTitle = (pin: number): string => {
  const found = findBoardPin(hardwareBoard(), pin);
  return found?.analogName ? `${found.name} (${found.analogName})` : activePinLabel(pin);
};

/** Pin number of analog input `A<channel>` on the active board. */
export const analogChannelPin = (channel: number): number | undefined => boardAnalogPins(hardwareBoard()).find((pin) => pin.adcChannel === channel)?.pin;

export const isActivePwmPin = (pin: number): boolean => boardPwmPins(hardwareBoard()).includes(pin);
export const activePwmPins = (): readonly number[] => boardPwmPins(hardwareBoard());
export const activeAnalogPins = (): readonly BoardPin[] => boardAnalogPins(hardwareBoard());

/** `LED_BUILTIN` of the active board: 13 on the ATmega boards, 1 on the ATtiny85. */
export const activeLedBuiltin = (): number => resolveBoardPin(hardwareBoard(), "LED_BUILTIN") ?? 13;

import type { McuId } from "../mcu/mcus";
import type { BoardHardwareId } from "./ids";

export type PortName = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "J" | "K" | "L";

/** One Arduino pin of a board as the pinned core numbers it (plan 4.3). */
export interface PinHardware {
  /** Arduino pin number of the core (Uno: A0 = 14). */
  readonly pin: number;
  readonly label: string;
  /** Missing for analog-only inputs such as A6/A7 on the Nano. */
  readonly port?: { readonly port: PortName; readonly bit: number };
  readonly adcChannel?: number;
  /**
   * Analog name when it is a second name of a digital pin (ATtiny85: pin 2 is
   * also `A1`); boards with separate analog pin numbers (Uno: A0 = 14) carry
   * it in `label`.
   */
  readonly analogName?: string;
  readonly pwm?: { readonly timer: number; readonly channel: "A" | "B" | "C" };
  readonly role?: "reset" | "serial";
}

interface SerialPortPins {
  /** Port index in the protocol: 0 = `Serial`, 1 = `Serial1`, … */
  readonly index: number;
  readonly rxPin: number;
  readonly txPin: number;
}

/** A hardware USART, or the core's software UART on a board without one (ATtiny85, `io/software-uart.ts`). */
export type SerialPortHardware =
  | (SerialPortPins & { readonly kind: "usart"; readonly usart: number })
  | (SerialPortPins & { readonly kind: "software"; readonly usart?: undefined });

export interface BoardHardware {
  readonly id: BoardHardwareId;
  readonly mcu: McuId;
  readonly clockHz: number;
  /** Reference of the analog sliders. */
  readonly vccVolts: number;
  readonly ledBuiltin: number;
  readonly pins: readonly PinHardware[];
  readonly serialPorts: readonly SerialPortHardware[];
}

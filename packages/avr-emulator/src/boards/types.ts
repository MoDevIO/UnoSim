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
  readonly pwm?: { readonly timer: number; readonly channel: "A" | "B" | "C" };
  readonly role?: "reset" | "serial";
}

export interface SerialPortHardware {
  /** Port index in the protocol: 0 = `Serial`, 1 = `Serial1`, … */
  readonly index: number;
  readonly kind: "usart";
  readonly usart: number;
  readonly rxPin: number;
  readonly txPin: number;
}

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

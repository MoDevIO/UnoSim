import { type AVRIOPort, PinState } from "avr8js";
import type { PinHardware, PortName } from "../boards/types";
import type { Machine } from "../machine";

export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";
export type Level = 0 | 1;

/** Digital state of one Arduino pin. */
export interface PinSnapshot {
  readonly pin: number;
  readonly mode: PinMode;
  readonly level: Level;
}

export interface PinChanges {
  /** Last state of every pin that changed since the previous call, by pin number. */
  readonly changes: readonly PinSnapshot[];
  /** Number of individual changes in that period, for the telemetry pin rate. */
  readonly changeCount: number;
}

interface DigitalPin {
  readonly hardware: PinHardware & { readonly port: { readonly port: PortName; readonly bit: number } };
  readonly io: AVRIOPort;
}

/**
 * Digital pins of a machine with the model assumptions of plan 4.8:
 * an open input reads LOW, INPUT_PULLUP reads HIGH, and a level set from
 * outside wins until the sketch makes the pin an OUTPUT.
 */
export class PinModel {
  private readonly pins = new Map<number, DigitalPin>();
  private readonly external = new Map<number, Level>();
  private readonly current = new Map<number, PinSnapshot>();
  private readonly changed = new Set<number>();
  private changeCount = 0;

  constructor(private readonly machine: Machine) {
    const byPort = new Map<PortName, DigitalPin[]>();
    for (const hardware of machine.board.pins) {
      if (!hardware.port) continue;
      const io = machine.peripherals.ports.get(hardware.port.port);
      if (!io) throw new RangeError(`${machine.mcu.id} has no port ${hardware.port.port} for ${hardware.label}`);
      const pin = { hardware: { ...hardware, port: hardware.port }, io };
      this.pins.set(hardware.pin, pin);
      byPort.set(hardware.port.port, [...(byPort.get(hardware.port.port) ?? []), pin]);
    }
    for (const portPins of byPort.values()) {
      portPins[0].io.addListener(() => this.refresh(portPins));
      this.refresh(portPins);
    }
    this.changed.clear();
    this.changeCount = 0;
  }

  /** All digital pins, ordered by pin number. */
  snapshot(): PinSnapshot[] {
    return [...this.current.values()].sort((a, b) => a.pin - b.pin);
  }

  state(pin: number): PinSnapshot {
    const state = this.current.get(pin);
    if (!state) throw new RangeError(`pin ${pin} is not a digital pin of ${this.machine.board.id}`);
    return state;
  }

  /**
   * Drives a pin from outside (click on the board). Ignored while the sketch
   * drives the pin as OUTPUT; returns whether the level was applied.
   */
  setDigital(pin: number, level: Level): boolean {
    const digital = this.pins.get(pin);
    if (!digital) throw new RangeError(`pin ${pin} is not a digital pin of ${this.machine.board.id}`);
    if (this.state(pin).mode === "OUTPUT") return false;
    this.external.set(pin, level);
    this.refresh([digital]);
    return true;
  }

  /** Changes since the last call; resets the change list and counter. */
  takeChanges(): PinChanges {
    const result = { changes: [...this.changed].sort((a, b) => a - b).map((pin) => this.state(pin)), changeCount: this.changeCount };
    this.changed.clear();
    this.changeCount = 0;
    return result;
  }

  private refresh(pins: readonly DigitalPin[]): void {
    const { data } = this.machine.cpu;
    for (const { hardware, io } of pins) {
      const { pin } = hardware;
      const mask = 1 << hardware.port.bit;
      let next: PinSnapshot;
      if (data[io.portConfig.DDR] & mask) {
        this.external.delete(pin); // the sketch took the pin over
        next = { pin, mode: "OUTPUT", level: io.pinState(hardware.port.bit) === PinState.High ? 1 : 0 };
      } else {
        const pullUp = (data[io.portConfig.PORT] & mask) !== 0;
        const level: Level = this.external.get(pin) ?? (pullUp ? 1 : 0);
        io.setPin(hardware.port.bit, level === 1);
        next = { pin, mode: pullUp ? "INPUT_PULLUP" : "INPUT", level };
      }
      const previous = this.current.get(pin);
      if (previous?.mode !== next.mode || previous.level !== next.level) {
        this.current.set(pin, next);
        this.changed.add(pin);
        this.changeCount++;
      }
    }
  }
}

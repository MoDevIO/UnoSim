import { type AVRIOPort, PinState } from "avr8js";
import type { PinHardware, PortName } from "../boards/types";
import type { Machine } from "../machine";
import { pwmDuty, pwmRegisterAddresses } from "./pwm";

export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";
export type Level = 0 | 1;

/** Digital state of one Arduino pin. */
export interface PinSnapshot {
  readonly pin: number;
  readonly mode: PinMode;
  /** Digital level; while PWM drives the pin, the rounded mean level. */
  readonly level: Level;
  /** Duty cycle 0–255 while a timer drives the pin with PWM (plan 4.8: no waveform). */
  readonly pwm?: number;
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
 * outside wins until the sketch makes the pin an OUTPUT. PWM pins report
 * their duty cycle instead of every edge of the waveform.
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
    this.observePwmTimers();
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

  /** Levels currently driven from outside, by pin (a reset keeps them, like wires on the board). */
  outsideLevels(): ReadonlyMap<number, Level> {
    return new Map(this.external);
  }

  /** Changes since the last call; resets the change list and counter. */
  takeChanges(): PinChanges {
    const result = { changes: [...this.changed].sort((a, b) => a - b).map((pin) => this.state(pin)), changeCount: this.changeCount };
    this.changed.clear();
    this.changeCount = 0;
    return result;
  }

  /** Re-evaluates PWM pins after every write to a register of their timer. */
  private observePwmTimers(): void {
    const { cpu, mcu } = this.machine;
    const byTimer = new Map<number, DigitalPin[]>();
    for (const pin of this.pins.values()) {
      const timer = pin.hardware.pwm?.timer;
      if (timer !== undefined) byTimer.set(timer, [...(byTimer.get(timer) ?? []), pin]);
    }
    for (const [timer, pins] of byTimer) {
      for (const address of pwmRegisterAddresses(mcu.timerRegisters[timer])) {
        const previous = cpu.writeHooks[address];
        cpu.writeHooks[address] = (value, oldValue, addr, mask) => {
          if (!previous?.(value, oldValue, addr, mask)) cpu.data[addr] = value;
          this.refresh(pins);
          return true;
        };
      }
    }
  }

  private refresh(pins: readonly DigitalPin[]): void {
    for (const pin of pins) this.record(this.nextState(pin));
  }

  private nextState({ hardware, io }: DigitalPin): PinSnapshot {
    const { data } = this.machine.cpu;
    const { pin } = hardware;
    const mask = 1 << hardware.port.bit;
    if (data[io.portConfig.DDR] & mask) {
      this.external.delete(pin); // the sketch took the pin over
      const pwm = hardware.pwm && pwmDuty(data, this.machine.mcu.timerRegisters[hardware.pwm.timer], hardware.pwm.channel);
      if (pwm !== undefined) return { pin, mode: "OUTPUT", level: pwm >= 128 ? 1 : 0, pwm };
      return { pin, mode: "OUTPUT", level: io.pinState(hardware.port.bit) === PinState.High ? 1 : 0 };
    }
    const pullUp = (data[io.portConfig.PORT] & mask) !== 0;
    const level: Level = this.external.get(pin) ?? (pullUp ? 1 : 0);
    io.setPin(hardware.port.bit, level === 1);
    return { pin, mode: pullUp ? "INPUT_PULLUP" : "INPUT", level };
  }

  private record(next: PinSnapshot): void {
    const previous = this.current.get(next.pin);
    if (previous?.mode === next.mode && previous.level === next.level && previous.pwm === next.pwm) return;
    this.current.set(next.pin, next);
    this.changed.add(next.pin);
    this.changeCount++;
  }
}

import type { PinHardware } from "../boards/types";
import type { Machine } from "../machine";

/** Steps of the analog sliders, as `analogRead()` returns them with the default reference. */
export const ANALOG_STEPS = 1024;

/**
 * Analog inputs of a machine (plan P1.6, model 4.8): a slider value 0–1023
 * becomes the voltage `(value + 0.5) / 1024 · VCC`, so `analogRead()` with
 * the default reference returns exactly that value. The internal references
 * come from the datasheet; AREF (EXTERNAL) is VCC unless set otherwise,
 * because the board has nothing connected there.
 */
export class AnalogInputs {
  private readonly channels = new Map<number, number>();

  constructor(private readonly machine: Machine) {
    const { adc } = machine.peripherals;
    for (const pin of machine.board.pins) {
      if (pin.adcChannel !== undefined) this.channels.set(pin.pin, pin.adcChannel);
    }
    adc.avcc = machine.board.vccVolts;
    adc.aref = machine.board.vccVolts;
  }

  /** Arduino pins with an ADC channel, ordered by pin number. */
  get pins(): readonly number[] {
    return [...this.channels.keys()].sort((a, b) => a - b);
  }

  /** Sets a slider value 0–1023 on an analog pin. */
  setAnalog(pin: number, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= ANALOG_STEPS) {
      throw new RangeError(`analog value must be an integer 0–${ANALOG_STEPS - 1}, got ${value}`);
    }
    this.setVolts(pin, ((value + 0.5) / ANALOG_STEPS) * this.machine.board.vccVolts);
  }

  /** Sets a voltage 0–VCC on an analog pin (headless runs, corpus stimuli). */
  setVolts(pin: number, volts: number): void {
    const channel = this.channelOf(pin);
    if (!Number.isFinite(volts) || volts < 0 || volts > this.machine.board.vccVolts) {
      throw new RangeError(`voltage must be 0–${this.machine.board.vccVolts} V, got ${volts}`);
    }
    this.machine.peripherals.adc.channelValues[channel] = volts;
  }

  volts(pin: number): number {
    return this.machine.peripherals.adc.channelValues[this.channelOf(pin)] ?? 0;
  }

  get arefVolts(): number {
    return this.machine.peripherals.adc.aref;
  }

  /** Voltage at AREF for `analogReference(EXTERNAL)`. */
  setArefVolts(volts: number): void {
    if (!Number.isFinite(volts) || volts <= 0 || volts > this.machine.board.vccVolts) {
      throw new RangeError(`AREF must be above 0 and at most ${this.machine.board.vccVolts} V, got ${volts}`);
    }
    this.machine.peripherals.adc.aref = volts;
  }

  private channelOf(pin: number): NonNullable<PinHardware["adcChannel"]> {
    const channel = this.channels.get(pin);
    if (channel === undefined) throw new RangeError(`pin ${pin} is not an analog input of ${this.machine.board.id}`);
    return channel;
  }
}

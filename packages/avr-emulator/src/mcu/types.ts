import type { AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRTimer, AVRUSART, AVRWatchdog, CPU } from "avr8js";
import type { PortName } from "../boards/types";
import type { TimerRegisters } from "../io/pwm";
import type { MemoryLayout } from "./memory";
import type { McuId } from "./mcus";

export interface McuPeripherals {
  readonly ports: ReadonlyMap<PortName, AVRIOPort>;
  readonly timers: readonly AVRTimer[];
  readonly usarts: readonly AVRUSART[];
  readonly adc: AVRADC;
  readonly eeprom: AVREEPROM;
  readonly watchdog: AVRWatchdog;
  readonly clock: AVRClock;
}

export interface McuProfile {
  readonly id: McuId;
  readonly flashBytes: number;
  readonly memory: MemoryLayout;
  readonly eepromBytes: number;
  /** ADC registers for the I/O observation; `channel` reads the selected input from the data space. */
  readonly adcRegisters: {
    readonly ADCSRA: number;
    readonly ADMUX: number;
    readonly ADCL: number;
    readonly ADCH: number;
    channel(data: Uint8Array): number;
  };
  /** Sleep enable bit (SE) for the diagnostics: SMCR on the ATmega, MCUCR on the ATtiny85. */
  readonly sleepEnable: { readonly register: number; readonly mask: number };
  /** Timer registers by timer number, for PWM observation. */
  readonly timerRegisters: readonly TimerRegisters[];
  /**
   * Timers, ports, USARTs, ADC, EEPROM, watchdog and clock prescaler for one
   * CPU. `eeprom` (eepromBytes long) is the EEPROM content; the peripheral
   * reads and writes it in place.
   */
  createPeripherals(cpu: CPU, clockHz: number, eeprom: Uint8Array): McuPeripherals;
}

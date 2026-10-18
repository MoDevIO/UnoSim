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
  /** Timer registers by timer number, for PWM observation. */
  readonly timerRegisters: readonly TimerRegisters[];
  /** Timers, ports, USARTs, ADC, EEPROM, watchdog and clock prescaler for one CPU. */
  createPeripherals(cpu: CPU, clockHz: number): McuPeripherals;
}

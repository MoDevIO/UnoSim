import {
  AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRTimer, AVRWatchdog,
  adcConfig, atmega328Channels, clockConfig, eepromConfig, portBConfig, portCConfig, portDConfig,
  timer0Config, timer1Config, timer2Config, usart0Config, watchdogConfig,
} from "avr8js";
import type { AVRTimerConfig } from "avr8js";
import type { TimerRegisters } from "../io/pwm";
import { ArrayEepromBackend } from "./eeprom";
import { MCU_FLASH_BYTES } from "./mcus";
import { createUsart } from "./usart";
import type { McuProfile } from "./types";

const timerRegisters = ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR }: AVRTimerConfig): TimerRegisters => ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR });

/**
 * ATmega328P (Uno, Nano). avr8js ships configurations for exactly this MCU;
 * only the data-space size must be set explicitly (plan 4.3).
 */
export const ATMEGA328P: McuProfile = {
  id: "atmega328p",
  flashBytes: MCU_FLASH_BYTES.atmega328p,
  memory: { sramStart: 0x100, sramBytes: 2048 },
  eepromBytes: 1024,
  adcRegisters: {
    ADCSRA: adcConfig.ADCSRA,
    ADMUX: adcConfig.ADMUX,
    ADCL: adcConfig.ADCL,
    ADCH: adcConfig.ADCH,
    channel: (data) => data[adcConfig.ADMUX] & 0x0f,
  },
  sleepEnable: { register: 0x53, mask: 0x01 }, // SMCR.SE
  timerRegisters: [timer0Config, timer1Config, timer2Config].map(timerRegisters),
  createPeripherals(cpu, clockHz, eeprom) {
    const clock = new AVRClock(cpu, clockHz, clockConfig);
    return {
      ports: new Map([
        ["B", new AVRIOPort(cpu, portBConfig)],
        ["C", new AVRIOPort(cpu, portCConfig)],
        ["D", new AVRIOPort(cpu, portDConfig)],
      ]),
      timers: [timer0Config, timer1Config, timer2Config].map((config) => new AVRTimer(cpu, config)),
      usarts: [createUsart(cpu, usart0Config, clockHz)],
      adc: new AVRADC(cpu, { ...adcConfig, numChannels: 8, muxChannels: atmega328Channels }),
      eeprom: new AVREEPROM(cpu, new ArrayEepromBackend(eeprom), eepromConfig),
      watchdog: new AVRWatchdog(cpu, watchdogConfig, clock),
      clock,
    };
  },
};

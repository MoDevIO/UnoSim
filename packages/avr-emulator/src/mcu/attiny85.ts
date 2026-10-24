import {
  ADCMuxInputType, ADCReference, ATtinyTimer1, AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRTimer, AVRWatchdog,
  adcConfig, attinyTimer1Config, eepromConfig, timer0Config, watchdogConfig,
} from "avr8js";
import type { ADCConfig, AVRPortConfig, AVRTimerConfig, CPU } from "avr8js";
import type { TimerRegisters } from "../io/pwm";
import { ArrayEepromBackend } from "./eeprom";
import { MCU_FLASH_BYTES } from "./mcus";
import type { McuProfile } from "./types";

/**
 * ATtiny85 (plan P6.2; spike P0.5). One port (B), timer 0, the ATtiny timer 1,
 * a 4-channel ADC, EEPROM, watchdog, no USART (the core's `Serial` is a
 * software UART, P6.3). Addresses are the I/O addresses of `avr/iotnx5.h` plus
 * 0x20; the vector table has one word per entry (RJMP), so vector n sits at
 * word address n.
 */
const VECTOR = {
  int0: 1,
  pcint0: 2,
  timer1CompA: 3,
  timer1Ovf: 4,
  timer0Ovf: 5,
  eepromReady: 6,
  analogComparator: 7, // receive model of the software UART (P6.3)
  adc: 8,
  timer1CompB: 9,
  timer0CompA: 10,
  timer0CompB: 11,
  wdt: 12,
} as const;

const PINB = 0x36;
const DDRB = 0x37;
const PORTB = 0x38;
const ADCL = 0x24;
const ADCH = 0x25;
const ADCSRA = 0x26;
const ADMUX = 0x27;
const ADCSRB = 0x23;
const DIDR0 = 0x34;
const PCMSK = 0x35;
const MCUSR = 0x54;
const MCUCR = 0x55;
const GIFR = 0x5a;
const GIMSK = 0x5b;
const WDTCR = 0x41;
const CLKPR = 0x46;
/** GIMSK/GIFR bits: INT0 and the pin-change interrupt share both registers. */
const INT0_BIT = 6;
const PCIE_BIT = 5;

/** INT0 on PB2 (ISC01:ISC00 in MCUCR bits 1:0); pin change on PB0–PB5. */
const portB: AVRPortConfig = {
  PIN: PINB,
  DDR: DDRB,
  PORT: PORTB,
  pinChange: { PCIE: PCIE_BIT, PCICR: GIMSK, PCIFR: GIFR, PCMSK, pinChangeInterrupt: VECTOR.pcint0, mask: 0x3f, offset: 0 },
  externalInterrupts: [null, null, { EICR: MCUCR, EIMSK: GIMSK, EIFR: GIFR, index: INT0_BIT, iscOffset: 0, interrupt: VECTOR.int0 }],
};

type InterruptConfig = Parameters<CPU["updateInterruptEnable"]>[0];

/** The same interrupts as avr8js keeps them inside the port, for the shared registers below. */
const int0Interrupt: InterruptConfig = { address: VECTOR.int0, flagRegister: GIFR, flagMask: 1 << INT0_BIT, enableRegister: GIMSK, enableMask: 1 << INT0_BIT };
const pcintInterrupt: InterruptConfig = { address: VECTOR.pcint0, flagRegister: GIFR, flagMask: 1 << PCIE_BIT, enableRegister: GIMSK, enableMask: 1 << PCIE_BIT };

/**
 * avr8js hooks GIMSK only for the external interrupts and gives GIFR to the
 * pin-change interrupt alone (the ATmega has separate registers for both).
 * Here a write to GIMSK also enables PCINT0, and a 1 written to GIFR also
 * clears INTF0.
 */
function shareInterruptRegisters(cpu: CPU): void {
  const maskHook = cpu.writeHooks[GIMSK];
  cpu.writeHooks[GIMSK] = (value, oldValue, address, mask) => {
    const handled = maskHook?.(value, oldValue, address, mask) ?? false;
    cpu.updateInterruptEnable(pcintInterrupt, value);
    return handled;
  };
  const flagHook = cpu.writeHooks[GIFR];
  cpu.writeHooks[GIFR] = (value, oldValue, address, mask) => {
    cpu.clearInterruptByFlag(int0Interrupt, value);
    return flagHook?.(value, oldValue, address, mask) ?? true;
  };
}

/** Timer 0: own registers and vectors; OC0A on PB0, OC0B on PB1, T0 on PB2. */
const timer0: AVRTimerConfig = {
  ...timer0Config,
  TCCRA: 0x4a,
  TCCRB: 0x53,
  TCNT: 0x52,
  OCRA: 0x49,
  OCRB: 0x48,
  TIFR: 0x58,
  TIMSK: 0x59,
  TOV: 1 << 1,
  OCFA: 1 << 4,
  OCFB: 1 << 3,
  TOIE: 1 << 1,
  OCIEA: 1 << 4,
  OCIEB: 1 << 3,
  ovfInterrupt: VECTOR.timer0Ovf,
  compAInterrupt: VECTOR.timer0CompA,
  compBInterrupt: VECTOR.timer0CompB,
  compPortA: PORTB,
  compPinA: 0,
  compPortB: PORTB,
  compPinB: 1,
  externalClockPort: PORTB,
  externalClockPin: 2,
};

const adc: ADCConfig = {
  ...adcConfig,
  ADMUX,
  ADCSRA,
  ADCSRB,
  ADCL,
  ADCH,
  DIDR0,
  adcInterrupt: VECTOR.adc,
  numChannels: 4,
  muxInputMask: 0x0f,
  // ADC0–3 on PB5, PB2, PB4, PB3; 1.1 V, GND and the temperature sensor; differential inputs are not modelled.
  muxChannels: {
    0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
    1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
    2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
    3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
    12: { type: ADCMuxInputType.Constant, voltage: 1.1 },
    13: { type: ADCMuxInputType.Constant, voltage: 0 },
    15: { type: ADCMuxInputType.Temperature },
  },
  // Index REFS2:REFS1:REFS0 (datasheet table 17-3): VCC, AREF (PB0), 1.1 V, reserved, VCC, AREF, 2.56 V, 2.56 V.
  adcReferences: [
    ADCReference.AVCC, ADCReference.AREF, ADCReference.Internal1V1, ADCReference.Reserved,
    ADCReference.AVCC, ADCReference.AREF, ADCReference.Internal2V56, ADCReference.Internal2V56,
  ],
};

/** avr8js 0.21.1 reads REFS2 at bit 3 (MUX3 on the ATtiny85); here it is bit 4 (spike P0.5: 102 instead of 200 at 2.56 V). */
class Attiny85ADC extends AVRADC {
  private readonly dataSpace: Uint8Array;

  constructor(cpu: CPU, config: ADCConfig) {
    super(cpu, config);
    this.dataSpace = cpu.data;
  }

  override get referenceVoltageType(): ADCReference {
    const value = this.dataSpace[ADMUX];
    return adc.adcReferences[((value >> 6) & 0x03) | (value & 0x10 ? 0x04 : 0)] ?? ADCReference.Reserved;
  }
}

const timerRegisters = ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR }: AVRTimerConfig): TimerRegisters => ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR });

/** avr8js times EEPROM writes for 16 MHz; 1.8 ms each for erase and write at the clock of the board. */
const eepromCycles = (clockHz: number): number => Math.round(clockHz * 0.0018);

export const ATTINY85: McuProfile = {
  id: "attiny85",
  flashBytes: MCU_FLASH_BYTES.attiny85,
  memory: { sramStart: 0x60, sramBytes: 512 },
  eepromBytes: 512,
  adcRegisters: {
    ADCSRA,
    ADMUX,
    ADCL,
    ADCH,
    channel: (data) => data[ADMUX] & 0x0f,
  },
  sleepEnable: { register: MCUCR, mask: 0x20 }, // MCUCR.SE
  // Timer 1 of the ATtiny85 has its own register set (TCCR1, GTCCR, OCR1A–C); its PWM observation follows with the board (P6.4).
  timerRegisters: [timerRegisters(timer0)],
  createPeripherals(cpu, clockHz, eeprom) {
    const clock = new AVRClock(cpu, clockHz, { CLKPR });
    const port = new AVRIOPort(cpu, portB);
    shareInterruptRegisters(cpu);
    return {
      ports: new Map([["B", port]]),
      timers: [new AVRTimer(cpu, timer0), new ATtinyTimer1(cpu, attinyTimer1Config)],
      usarts: [],
      adc: new Attiny85ADC(cpu, adc),
      eeprom: new AVREEPROM(cpu, new ArrayEepromBackend(eeprom), {
        ...eepromConfig,
        EECR: 0x3c,
        EEDR: 0x3d,
        EEARL: 0x3e,
        EEARH: 0x3f,
        eepromReadyInterrupt: VECTOR.eepromReady,
        eraseCycles: eepromCycles(clockHz),
        writeCycles: eepromCycles(clockHz),
      }),
      watchdog: new AVRWatchdog(cpu, { ...watchdogConfig, MCUSR, WDTCSR: WDTCR, watchdogInterrupt: VECTOR.wdt }, clock),
      clock,
    };
  },
};

import {
  ADCMuxInputType, ADCReference, AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRTimer, AVRWatchdog,
  adcConfig, clockConfig, eepromConfig, portAConfig, portBConfig, portCConfig, portDConfig, portEConfig,
  portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig, timer0Config, timer1Config,
  timer2Config, usart0Config, watchdogConfig,
} from "avr8js";
import type { ADCMuxConfiguration, AVRExternalInterrupt, AVRPinChangeInterrupt, AVRPortConfig, AVRTimerConfig } from "avr8js";
import type { PortName } from "../boards/types";
import type { TimerRegisters } from "../io/pwm";
import { ArrayEepromBackend } from "./eeprom";
import { MCU_FLASH_BYTES } from "./mcus";
import { createUsart } from "./usart";
import type { McuProfile } from "./types";

/**
 * ATmega2560 (Mega 2560). avr8js ships configurations for the ATmega328P
 * only: its vectors, timers and ports do not fit here (spike P0.6), so every
 * peripheral gets a configuration of its own. Addresses and vectors follow
 * `avr/iomxx0_1.h` of avr-libc in the pinned toolchain; the vector table has
 * two words per entry (JMP), vector number n sits at word address 2·n (RESET = 0).
 */
const vector = (n: number): number => n * 2;

const timerRegisters = ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR }: AVRTimerConfig): TimerRegisters => ({ bits, TCCRA, TCCRB, OCRA, OCRB, OCRC, ICR });

// Register addresses (data space).
const EICRA = 0x69;
const EICRB = 0x6a;
const EIMSK = 0x3d;
const EIFR = 0x3c;
const PCICR = 0x68;
const PCIFR = 0x3b;
const PCMSK0 = 0x6b;
const PCMSK1 = 0x6c;
const PCMSK2 = 0x6d;
const ADCSRB = adcConfig.ADCSRB;
const MUX5 = 0x08;

// Interrupt vectors (zero-based position in the table).
const VECTOR = {
  int0: 1, // INT0–INT3 at 1–4, INT4–INT7 at 5–8
  pcint0: 9, pcint1: 10, pcint2: 11,
  wdt: 12,
  timer2: 13, // COMPA, COMPB, OVF
  timer1: 16, // CAPT, COMPA, COMPB, COMPC, OVF
  timer0: 21, // COMPA, COMPB, OVF
  usart0: 25, // RX, UDRE, TX
  adc: 29,
  eepromReady: 30,
  timer3: 31,
  usart1: 36,
  timer4: 41,
  timer5: 46,
  usart2: 51,
  usart3: 54,
} as const;

const external = (index: number, interruptVector: number): AVRExternalInterrupt => ({
  EICR: index < 4 ? EICRA : EICRB,
  EIMSK,
  EIFR,
  index,
  iscOffset: (index % 4) * 2,
  interrupt: vector(interruptVector),
});

const pinChange = (PCIE: number, PCMSK: number, pinChangeInterrupt: number, mask: number, offset: number): AVRPinChangeInterrupt => ({
  PCIE, PCICR, PCIFR, PCMSK, pinChangeInterrupt: vector(pinChangeInterrupt), mask, offset,
});

// INT0–INT3 on PD0–PD3, INT4–INT7 on PE4–PE7; PCINT0 on port B, PCINT1 on PE0 and PJ0–PJ6, PCINT2 on port K.
// Only the register addresses come from avr8js: its ports B, C and D carry the pin-change wiring of the 328P.
const registersOf = ({ PIN, DDR, PORT }: AVRPortConfig) => ({ PIN, DDR, PORT });
const plainPort = (config: AVRPortConfig): AVRPortConfig => ({ ...registersOf(config), externalInterrupts: [] });
const portConfigs: ReadonlyMap<PortName, AVRPortConfig> = new Map<PortName, AVRPortConfig>([
  ["A", plainPort(portAConfig)],
  ["B", { ...plainPort(portBConfig), pinChange: pinChange(0, PCMSK0, VECTOR.pcint0, 0xff, 0) }],
  ["C", plainPort(portCConfig)],
  ["D", { ...plainPort(portDConfig), externalInterrupts: [0, 1, 2, 3].map((i) => external(i, VECTOR.int0 + i)) }],
  [
    "E",
    {
      ...plainPort(portEConfig),
      pinChange: pinChange(1, PCMSK1, VECTOR.pcint1, 0x01, 0),
      externalInterrupts: [null, null, null, null, ...[4, 5, 6, 7].map((i) => external(i, VECTOR.int0 + i))],
    },
  ],
  ["F", plainPort(portFConfig)],
  ["G", plainPort(portGConfig)],
  ["H", plainPort(portHConfig)],
  ["J", { ...plainPort(portJConfig), pinChange: pinChange(1, PCMSK1, VECTOR.pcint1, 0x7f, 1) }],
  ["K", { ...plainPort(portKConfig), pinChange: pinChange(2, PCMSK2, VECTOR.pcint2, 0xff, 0) }],
  ["L", plainPort(portLConfig)],
]);

const port = (name: PortName): number => (portConfigs.get(name) as AVRPortConfig).PORT;

/** 16-bit timer 1, 3, 4 or 5: registers at `base`, compare channel C, bit 3 of TIFR/TIMSK for OCFnC/OCIEnC. */
function timer16(base: number, TIMSK: number, TIFR: number, firstVector: number, compPort: PortName, pins: readonly [number, number, number], clockPin: readonly [PortName, number]): AVRTimerConfig {
  return {
    ...timer1Config,
    OCFC: 8,
    OCIEC: 8,
    captureInterrupt: vector(firstVector),
    compAInterrupt: vector(firstVector + 1),
    compBInterrupt: vector(firstVector + 2),
    compCInterrupt: vector(firstVector + 3),
    ovfInterrupt: vector(firstVector + 4),
    TIFR,
    TIMSK,
    TCCRA: base,
    TCCRB: base + 1,
    TCCRC: base + 2,
    TCNT: base + 4,
    ICR: base + 6,
    OCRA: base + 8,
    OCRB: base + 10,
    OCRC: base + 12,
    compPortA: port(compPort),
    compPinA: pins[0],
    compPortB: port(compPort),
    compPinB: pins[1],
    compPortC: port(compPort),
    compPinC: pins[2],
    externalClockPort: port(clockPin[0]),
    externalClockPin: clockPin[1],
  };
}

const timerConfigs: readonly AVRTimerConfig[] = [
  {
    ...timer0Config,
    compAInterrupt: vector(VECTOR.timer0),
    compBInterrupt: vector(VECTOR.timer0 + 1),
    ovfInterrupt: vector(VECTOR.timer0 + 2),
    compPortA: port("B"), compPinA: 7,
    compPortB: port("G"), compPinB: 5,
    externalClockPort: port("D"), externalClockPin: 7,
  },
  timer16(0x80, 0x6f, 0x36, VECTOR.timer1, "B", [5, 6, 7], ["D", 6]),
  {
    ...timer2Config,
    compAInterrupt: vector(VECTOR.timer2),
    compBInterrupt: vector(VECTOR.timer2 + 1),
    ovfInterrupt: vector(VECTOR.timer2 + 2),
    compPortA: port("B"), compPinA: 4,
    compPortB: port("H"), compPinB: 6,
  },
  timer16(0x90, 0x71, 0x38, VECTOR.timer3, "E", [3, 4, 5], ["E", 6]),
  timer16(0xa0, 0x72, 0x39, VECTOR.timer4, "H", [3, 4, 5], ["H", 7]),
  timer16(0x120, 0x73, 0x3a, VECTOR.timer5, "L", [3, 4, 5], ["L", 2]),
];

const usartVectors = (first: number) => ({
  rxCompleteInterrupt: vector(first),
  dataRegisterEmptyInterrupt: vector(first + 1),
  txCompleteInterrupt: vector(first + 2),
});

const usartConfigs = [
  { ...usart0Config, ...usartVectors(VECTOR.usart0) },
  { ...usartVectors(VECTOR.usart1), UCSRA: 0xc8, UCSRB: 0xc9, UCSRC: 0xca, UBRRL: 0xcc, UBRRH: 0xcd, UDR: 0xce },
  { ...usartVectors(VECTOR.usart2), UCSRA: 0xd0, UCSRB: 0xd1, UCSRC: 0xd2, UBRRL: 0xd4, UBRRH: 0xd5, UDR: 0xd6 },
  { ...usartVectors(VECTOR.usart3), UCSRA: 0x130, UCSRB: 0x131, UCSRC: 0x132, UBRRL: 0x134, UBRRH: 0x135, UDR: 0x136 },
];

/** MUX 0–7 = ADC0–7, MUX5 + 0–7 (0x20–0x27) = ADC8–15, 1.1 V and GND; differential inputs are not modelled. */
const muxChannels: ADCMuxConfiguration = {
  ...Object.fromEntries(Array.from({ length: 8 }, (_, channel) => [channel, { type: ADCMuxInputType.SingleEnded, channel }])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, channel) => [0x20 + channel, { type: ADCMuxInputType.SingleEnded, channel: 8 + channel }])),
  0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 },
  0x1f: { type: ADCMuxInputType.Constant, voltage: 0 },
};

const mega2560Adc = {
  ...adcConfig,
  adcInterrupt: vector(VECTOR.adc),
  numChannels: 16,
  muxInputMask: 0x3f,
  muxChannels,
  // REFS1:0 = AREF, AVCC, internal 1.1 V, internal 2.56 V
  adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Internal1V1, ADCReference.Internal2V56],
};

export const ATMEGA2560: McuProfile = {
  id: "atmega2560",
  flashBytes: MCU_FLASH_BYTES.atmega2560,
  memory: { sramStart: 0x200, sramBytes: 8192 },
  eepromBytes: 4096,
  adcRegisters: {
    ADCSRA: adcConfig.ADCSRA,
    ADMUX: adcConfig.ADMUX,
    ADCL: adcConfig.ADCL,
    ADCH: adcConfig.ADCH,
    channel: (data) => (data[adcConfig.ADMUX] & 0x07) | (data[ADCSRB] & MUX5 ? 0x08 : 0),
  },
  sleepEnable: { register: 0x53, mask: 0x01 }, // SMCR.SE
  timerRegisters: timerConfigs.map(timerRegisters),
  createPeripherals(cpu, clockHz, eeprom) {
    const clock = new AVRClock(cpu, clockHz, clockConfig);
    return {
      ports: new Map([...portConfigs].map(([name, config]) => [name, new AVRIOPort(cpu, config)])),
      timers: timerConfigs.map((config) => new AVRTimer(cpu, config)),
      usarts: usartConfigs.map((config) => createUsart(cpu, config, clockHz)),
      adc: new AVRADC(cpu, mega2560Adc),
      eeprom: new AVREEPROM(cpu, new ArrayEepromBackend(eeprom), { ...eepromConfig, eepromReadyInterrupt: vector(VECTOR.eepromReady) }),
      watchdog: new AVRWatchdog(cpu, { ...watchdogConfig, watchdogInterrupt: vector(VECTOR.wdt) }, clock),
      clock,
    };
  },
};

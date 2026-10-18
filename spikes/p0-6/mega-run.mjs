// Spike P0.6 – run an ATmega2560 image in avr8js with Mega-specific peripheral
// configurations (vectors and addresses from avr-libc iomxx0_1.h of the pinned
// toolchain). avr8js ships 328P configurations only; the ATmega2560 needs its
// own vectors for timers 0–2, USART0 and ADC and new configs for timers 3–5
// and USART1–3.
//
// Usage: node spikes/p0-6/mega-run.mjs <sketch.hex> <out.json> [simMs] [--no-mega-config] [--default-sram]
import { readFileSync, writeFileSync } from "node:fs";
import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRUSART, usart0Config, AVRIOPort, AVRADC, adcConfig, ADCMuxInputType,
  portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig,
  portGConfig, portHConfig, portJConfig, portKConfig, portLConfig,
} from "avr8js";

const CLOCK = 16_000_000;
const [hexPath, outFile, simMsArg, ...flags] = process.argv.slice(2);
const SIM_MS = Number(simMsArg ?? 1500);
const USE_328P_CONFIGS = flags.includes("--no-mega-config");
const DEFAULT_SRAM = flags.includes("--default-sram"); // avr8js default 8192 instead of 8448

// ---------- image: Intel HEX with record types 00, 01, 02, 04 ----------
export function parseIntelHex(text, flashBytes) {
  const flash = new Uint8Array(flashBytes);
  let base = 0, used = 0;
  const types = new Set();
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith(":")) throw new Error(`line ${n + 1}: missing ':'`);
    const b = Buffer.from(line.slice(1), "hex");
    const sum = b.reduce((a, x) => (a + x) & 0xff, 0);
    if (sum !== 0) throw new Error(`line ${n + 1}: checksum`);
    const [count, hi, lo, type] = b;
    types.add(type);
    if (type === 0) {
      const addr = base + ((hi << 8) | lo);
      if (addr + count > flashBytes) throw new Error(`line ${n + 1}: image exceeds ${flashBytes} bytes`);
      flash.set(b.subarray(4, 4 + count), addr);
      used = Math.max(used, addr + count);
    } else if (type === 1) break;
    else if (type === 2) base = ((b[4] << 8) | b[5]) << 4;
    else if (type === 4) base = ((b[4] << 8) | b[5]) << 16;
  }
  return { flash, used, types: [...types].sort() };
}

// ---------- ATmega2560 configuration ----------
const vec = (n) => n * 2; // word address of vector n (JMP = 2 words)
const bitsC = { OCFC: 8, OCIEC: 8 };
const timer01Dividers = { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 };
const PORTB = 0x25, PORTE = 0x2e, PORTG = 0x34, PORTH = 0x102, PORTL = 0x10b, PORTD = 0x2b;
const t16 = (n, base, timsk, tifr, capt, portComp, pins) => ({
  ...timer1Config, ...bitsC, bits: 16, dividers: timer01Dividers,
  captureInterrupt: vec(capt), compAInterrupt: vec(capt + 1), compBInterrupt: vec(capt + 2),
  compCInterrupt: vec(capt + 3), ovfInterrupt: vec(capt + 4),
  TIFR: tifr, TIMSK: timsk, TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4,
  ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12,
  compPortA: portComp, compPinA: pins[0], compPortB: portComp, compPinB: pins[1], compPortC: portComp, compPinC: pins[2],
  externalClockPort: 0, externalClockPin: 0,
});
const mega = {
  timers: [
    { ...timer0Config, compAInterrupt: vec(21), compBInterrupt: vec(22), ovfInterrupt: vec(23),
      compPortA: PORTB, compPinA: 7, compPortB: PORTG, compPinB: 5, externalClockPort: PORTD, externalClockPin: 7 },
    t16(1, 0x80, 0x6f, 0x36, 16, PORTB, [5, 6, 7]),
    { ...timer2Config, compAInterrupt: vec(13), compBInterrupt: vec(14), ovfInterrupt: vec(15),
      compPortA: PORTB, compPinA: 4, compPortB: PORTH, compPinB: 6 },
    t16(3, 0x90, 0x71, 0x38, 31, PORTE, [3, 4, 5]),
    t16(4, 0xa0, 0x72, 0x39, 41, PORTH, [3, 4, 5]),
    t16(5, 0x120, 0x73, 0x3a, 46, PORTL, [3, 4, 5]),
  ],
  usarts: [
    { ...usart0Config, rxCompleteInterrupt: vec(25), dataRegisterEmptyInterrupt: vec(26), txCompleteInterrupt: vec(27) },
    { rxCompleteInterrupt: vec(36), dataRegisterEmptyInterrupt: vec(37), txCompleteInterrupt: vec(38), UCSRA: 0xc8, UCSRB: 0xc9, UCSRC: 0xca, UBRRL: 0xcc, UBRRH: 0xcd, UDR: 0xce },
    { rxCompleteInterrupt: vec(51), dataRegisterEmptyInterrupt: vec(52), txCompleteInterrupt: vec(53), UCSRA: 0xd0, UCSRB: 0xd1, UCSRC: 0xd2, UBRRL: 0xd4, UBRRH: 0xd5, UDR: 0xd6 },
    { rxCompleteInterrupt: vec(54), dataRegisterEmptyInterrupt: vec(55), txCompleteInterrupt: vec(56), UCSRA: 0x130, UCSRB: 0x131, UCSRC: 0x132, UBRRL: 0x134, UBRRH: 0x135, UDR: 0x136 },
  ],
  adc: {
    ...adcConfig, adcInterrupt: vec(29), numChannels: 16, muxInputMask: 0x3f,
    muxChannels: {
      ...Object.fromEntries(Array.from({ length: 8 }, (_, c) => [c, { type: ADCMuxInputType.SingleEnded, channel: c }])),
      ...Object.fromEntries(Array.from({ length: 8 }, (_, c) => [0x20 + c, { type: ADCMuxInputType.SingleEnded, channel: 8 + c }])),
      0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 },
      0x1f: { type: ADCMuxInputType.Constant, voltage: 0 },
    },
  },
  // 328P pin-change/external-interrupt wiring does not apply; ports without interrupts.
  ports: [portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig, portGConfig,
    portHConfig, portJConfig, portKConfig, portLConfig].map((p) => ({ PIN: p.PIN, DDR: p.DDR, PORT: p.PORT, externalInterrupts: [] })),
};

// ---------- run ----------
const RAMEND = 0x21ff;
const SRAM_PARAM = RAMEND + 1 - 0x100; // avr8js allocates sramBytes + 0x100 (plan 4.3)
const { flash, used, types } = parseIntelHex(readFileSync(hexPath, "utf8"), 0x40000);
const cpu = DEFAULT_SRAM ? new CPU(new Uint16Array(flash.buffer)) : new CPU(new Uint16Array(flash.buffer), SRAM_PARAM);
const timers = (USE_328P_CONFIGS ? [timer0Config, timer1Config, timer2Config] : mega.timers).map((c) => new AVRTimer(cpu, c));
const usarts = (USE_328P_CONFIGS ? [usart0Config] : mega.usarts).map((c) => new AVRUSART(cpu, c, CLOCK));
const ports = mega.ports.map((c) => new AVRIOPort(cpu, c));
const adc = new AVRADC(cpu, USE_328P_CONFIGS ? adcConfig : mega.adc);
adc.channelValues[0] = 2.5;
if (!USE_328P_CONFIGS) adc.channelValues[15] = 3.42;
const serial = usarts.map(() => "");
usarts.forEach((u, i) => { u.onByteTransmit = (b) => { serial[i] += String.fromCharCode(b); }; });
const baud = usarts.map(() => null);
usarts.forEach((u, i) => { u.onConfigurationChange = () => { baud[i] = u.baudRate; }; });

const state = { spAfterReset: cpu.SP, dataBytes: cpu.data.length, pc22Bits: cpu.pc22Bits };
const end = SIM_MS * (CLOCK / 1000);
const started = performance.now();
let maxPc = 0;
while (cpu.cycles < end) {
  for (let i = 0; i < 1000; i++) { avrInstruction(cpu); cpu.tick(); if (cpu.pc > maxPc) maxPc = cpu.pc; }
}
const wallMs = performance.now() - started;
const r16 = (a) => cpu.data[a] | (cpu.data[a + 1] << 8);
const result = {
  hex: { usedBytes: used, recordTypes: types },
  cpu: { ...state, maxPcByte: maxPc * 2 },
  serial: serial.map((s) => s.replaceAll("\r", "")),
  baud,
  pwm: USE_328P_CONFIGS ? undefined : {
    "D44 OCR5C": r16(0x12c), "D45 OCR5B": r16(0x12a), "D46 OCR5A": r16(0x128),
    "D2 OCR3B": r16(0x9a), "D9 OCR2B": cpu.data[0xb4], "D13 OCR0A": cpu.data[0x47],
    "TCCR5A": cpu.data[0x120].toString(2).padStart(8, "0"), "TCCR3A": cpu.data[0x90].toString(2).padStart(8, "0"),
  },
  realTimeFactor: +(SIM_MS / wallMs).toFixed(2),
  timers: timers.length,
};
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));

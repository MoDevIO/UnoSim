// Spike P0.5 – run an ATtiny85 image (ATTinyCore 1.5.2, 8 MHz internal) in
// avr8js with an ATtiny85 profile: port B, timer 0 (own config), ATtinyTimer1,
// ADC with the ATtiny85 REFS2 bit, a software-UART decoder on the TX pin (PB0)
// and an analog comparator model so that TinySoftwareSerial can receive on PB1.
//
// Usage: node spikes/p0-5/tiny-run.mjs <sketch.hex> <out.json> [simMs] [--input "text"] [--avr8js-adc] [--default-sram]
import { readFileSync, writeFileSync } from "node:fs";
import {
  CPU, avrInstruction, AVRTimer, timer0Config, ATtinyTimer1, attinyTimer1Config,
  AVRIOPort, AVRADC, adcConfig, ADCMuxInputType, ADCReference,
} from "avr8js";

const CLOCK = 8_000_000;
const [hexPath, outFile, simMsArg, ...flags] = process.argv.slice(2);
const SIM_MS = Number(simMsArg ?? 1500);
const inputIdx = flags.indexOf("--input");
const INPUT = inputIdx >= 0 ? flags[inputIdx + 1] : null;
const AVR8JS_ADC = flags.includes("--avr8js-adc");
const DEFAULT_SRAM = flags.includes("--default-sram");
const RX_BAUD = 9600;

function loadHex(path, size) {
  const flash = new Uint8Array(size);
  let base = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.startsWith(":")) continue;
    const b = Buffer.from(line.slice(1), "hex");
    const [count, hi, lo, type] = b;
    if (type === 0) flash.set(b.subarray(4, 4 + count), base + ((hi << 8) | lo));
    else if (type === 2) base = ((b[4] << 8) | b[5]) << 4;
    else if (type === 4) base = ((b[4] << 8) | b[5]) << 16;
  }
  return new Uint16Array(flash.buffer);
}

// ---------- ATtiny85 profile (addresses: avr/iotnx5.h + 0x20) ----------
const PINB = 0x36, DDRB = 0x37, PORTB = 0x38, ACSR = 0x28, ADCSRB = 0x23, ADMUX = 0x27;
const RAMEND = 0x25f;
const SRAM_PARAM = RAMEND + 1 - 0x100; // 352 (plan 4.3)
const portB = { PIN: PINB, DDR: DDRB, PORT: PORTB, externalInterrupts: [] };
const timer0 = {
  ...timer0Config,
  TCCRA: 0x4a, TCCRB: 0x53, TCNT: 0x52, OCRA: 0x49, OCRB: 0x48, TIFR: 0x58, TIMSK: 0x59,
  TOV: 1 << 1, OCFA: 1 << 4, OCFB: 1 << 3, TOIE: 1 << 1, OCIEA: 1 << 4, OCIEB: 1 << 3,
  ovfInterrupt: 5, compAInterrupt: 10, compBInterrupt: 11, // one-word vectors
  compPortA: PORTB, compPinA: 0, compPortB: PORTB, compPinB: 1, externalClockPort: PORTB, externalClockPin: 2,
};
const adc = {
  ...adcConfig,
  ADMUX, ADCSRA: 0x26, ADCSRB, ADCL: 0x24, ADCH: 0x25, DIDR0: 0x34, adcInterrupt: 8,
  numChannels: 4, muxInputMask: 0x0f,
  muxChannels: {
    0: { type: ADCMuxInputType.SingleEnded, channel: 0 }, // PB5
    1: { type: ADCMuxInputType.SingleEnded, channel: 1 }, // PB2
    2: { type: ADCMuxInputType.SingleEnded, channel: 2 }, // PB4
    3: { type: ADCMuxInputType.SingleEnded, channel: 3 }, // PB3
    12: { type: ADCMuxInputType.Constant, voltage: 1.1 },
    13: { type: ADCMuxInputType.Constant, voltage: 0 },
    15: { type: ADCMuxInputType.Temperature },
  },
  // Index = REFS2:REFS1:REFS0 (datasheet table 17-3).
  adcReferences: [ADCReference.AVCC, ADCReference.AREF, ADCReference.Internal1V1, ADCReference.Reserved,
    ADCReference.AVCC, ADCReference.AREF, ADCReference.Internal2V56, ADCReference.Internal2V56],
};
/** avr8js reads REFS2 at bit 3; on the ATtiny85 it is bit 4 (bit 3 is MUX3). */
class Tiny85ADC extends AVRADC {
  get referenceVoltageType() {
    const v = this.cpu.data[ADMUX];
    const refs = ((v >> 6) & 3) | (v & 0x10 ? 4 : 0);
    return adc.adcReferences[refs];
  }
}

// ---------- machine ----------
const cpu = DEFAULT_SRAM ? new CPU(loadHex(hexPath, 0x2000)) : new CPU(loadHex(hexPath, 0x2000), SRAM_PARAM);
const spAfterReset = cpu.SP, dataBytes = cpu.data.length;
new AVRTimer(cpu, timer0);
new ATtinyTimer1(cpu, attinyTimer1Config);
const port = new AVRIOPort(cpu, portB);
const adcUnit = AVR8JS_ADC ? new AVRADC(cpu, adc) : new Tiny85ADC(cpu, adc);
adcUnit.channelValues[1] = 2.5; // A1 = PB2
adcUnit.channelValues[3] = 0.5; // A3 = PB3

// ---------- software-UART decoder on PB0 ----------
const edges = []; // [cycle, level]
let lastTx = 1;
port.addListener((value) => {
  // PB0 is also OC0A: while timer 0 drives it (COM0A bits), it carries PWM, not serial data.
  if (cpu.data[0x4a] & 0xc0) return;
  if (!(cpu.data[DDRB] & 1)) return; // TX only once PB0 is an output
  const level = value & 1;
  if (level !== lastTx) { edges.push([cpu.cycles, level]); lastTx = level; }
});
const STD_BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200];
function decodeTx() {
  // Bit width: the largest standard bit time of which (almost) every interval
  // between edges is a whole multiple; frames are separated by idle time, so
  // only intervals up to 9 bits count.
  const intervals = [];
  for (let i = 1; i < edges.length; i++) intervals.push(edges[i][0] - edges[i - 1][0]);
  const fits = (b) => {
    const bitT = CLOCK / b;
    const inFrame = intervals.filter((d) => d < bitT * 9.5);
    if (inFrame.length < 4) return false;
    const ok = inFrame.filter((d) => { const k = Math.round(d / bitT); return k >= 1 && Math.abs(d - k * bitT) < bitT * 0.2; });
    return ok.length >= inFrame.length * 0.95;
  };
  const baud = STD_BAUDS.find(fits) ?? 9600;
  const bit = CLOCK / baud;
  const levelAt = (t) => { let l = 1; for (const [c, v] of edges) { if (c > t) break; l = v; } return l; };
  const bytes = [];
  let i = 0, framingErrors = 0;
  while (i < edges.length) {
    if (edges[i][1] !== 0) { i++; continue; }
    const start = edges[i][0];
    let byte = 0;
    for (let b = 0; b < 8; b++) byte |= levelAt(start + bit * (1.5 + b)) << b;
    if (!levelAt(start + bit * 9.5)) framingErrors++;
    bytes.push(byte);
    const end = start + bit * 9.5;
    while (i < edges.length && edges[i][0] <= end) i++;
  }
  // Measured bit width over all single-bit runs close to the nominal width.
  const singles = [];
  for (let k = 1; k < edges.length; k++) { const d = edges[k][0] - edges[k - 1][0]; if (Math.abs(d - bit) < bit * 0.3) singles.push(d); }
  const measured = singles.length ? singles.reduce((a, b) => a + b, 0) / singles.length : null;
  return { baud, nominalBitCycles: bit, measuredBitCycles: measured && +measured.toFixed(1), framingErrors,
    text: new TextDecoder().decode(new Uint8Array(bytes)) };
}

// ---------- analog comparator (ACSR) and RX waveform on PB1 ----------
const ACD = 0x80, ACBG = 0x40, ACO = 0x20, ACI = 0x10, ACIE = 0x08, ACIS = 0x03;
const anaComp = { address: 7, enableRegister: ACSR, enableMask: ACIE, flagRegister: ACSR, flagMask: ACI };
let rxLevel = 1;
const comparatorOut = () => {
  const acsr = cpu.data[ACSR];
  if (acsr & ACD) return 0;
  const vPlus = acsr & ACBG ? 1.1 : (cpu.data[PINB] & 1 ? 5 : 0); // ACBG: bandgap instead of AIN0
  const vMinus = rxLevel ? 5 : 0; // AIN1 = PB1 (ACME = 0)
  return vPlus > vMinus ? 1 : 0;
};
const updateComparator = (prevOut) => {
  const out = comparatorOut();
  cpu.data[ACSR] = (cpu.data[ACSR] & ~ACO) | (out ? ACO : 0);
  const mode = cpu.data[ACSR] & ACIS; // 0 toggle, 2 falling, 3 rising
  const edge = out !== prevOut && (mode === 0 || (mode === 3 && out) || (mode === 2 && !out));
  if (edge && !(cpu.data[ACSR] & ACD)) cpu.setInterruptFlag(anaComp);
};
cpu.writeHooks[ACSR] = (value) => {
  const prevOut = (cpu.data[ACSR] & ACO) ? 1 : 0;
  cpu.data[ACSR] = (value & ~(ACO | ACI)) | (cpu.data[ACSR] & (ACO | ACI));
  if (value & ACI) cpu.clearInterruptByFlag(anaComp, value);
  cpu.updateInterruptEnable(anaComp, value);
  updateComparator(prevOut);
  return true;
};
const setRx = (level) => {
  const prevOut = comparatorOut();
  rxLevel = level;
  if (!(cpu.data[DDRB] & 2)) port.setPin(1, Boolean(level));
  updateComparator(prevOut);
};
setRx(1);
const rxBit = CLOCK / RX_BAUD;
function scheduleInput(text, atMs) {
  let t = atMs * CLOCK / 1000;
  for (const byte of new TextEncoder().encode(text)) {
    const bits = [0, ...Array.from({ length: 8 }, (_, b) => (byte >> b) & 1), 1];
    for (const [k, level] of bits.entries()) {
      const at = Math.round(t + k * rxBit);
      cpu.addClockEvent(() => setRx(level), at - cpu.cycles);
    }
    t += 12 * rxBit; // stop bit plus two idle bits between bytes
  }
}
if (INPUT !== null) scheduleInput(INPUT, 300);

// ---------- run ----------
const end = SIM_MS * (CLOCK / 1000);
const started = performance.now();
while (cpu.cycles < end) for (let i = 0; i < 1000; i++) { avrInstruction(cpu); cpu.tick(); }
const wallMs = performance.now() - started;
const result = {
  memory: { spAfterReset: `0x${spAfterReset.toString(16)}`, dataBytes, maxPeripheralAddress: "0x5f" },
  serial: decodeTx(),
  pwm: { "PB4 OCR1B": cpu.data[0x4b], "PB0 OCR0A": cpu.data[0x49], TCCR0A: cpu.data[0x4a].toString(2).padStart(8, "0"), GTCCR: cpu.data[0x4c].toString(2).padStart(8, "0") },
  realTimeFactor: +(SIM_MS / wallMs).toFixed(2),
  options: { input: INPUT, avr8jsAdc: AVR8JS_ADC, defaultSram: DEFAULT_SRAM },
};
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));

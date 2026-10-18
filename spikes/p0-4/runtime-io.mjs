// Spike P0.4 – runtime IO detection with avr8js register hooks.
//
// For every sketch it runs
//   - the real (LTO) build with register observation at three levels:
//       R0  only bit changes on DDR/PORT, ADC start, timer COM/OCR writes
//       R1  R0 + decoding the accessing instruction (SBI/CBI/SBIS/SBIC bit,
//           mask from the neighbouring OR/ORI/AND/ANDI/SBRS/SBRC)
//       R2  R1 + dropping the pinMode(OUTPUT) that analogWrite performs itself
//   - a reference build without LTO, where the five Arduino functions exist as
//     symbols; entry hooks read pin (r24) and value/mode (r22). Calls nested in
//     another I/O function (analogWrite -> pinMode) are not counted.
// Both runs get the same stimuli (serial input, external pin levels, ADC).
//
// Usage: node spikes/p0-4/runtime-io.mjs <build-dir> <build-nolto-dir> <out.json> [simMs]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRUSART, usart0Config, AVRIOPort, portBConfig, portCConfig, portDConfig, AVRADC, adcConfig,
} from "avr8js";

const CLOCK = 16_000_000;
const [buildDir, noLtoDir, outFile, simMsArg] = process.argv.slice(2);
const SIM_MS = Number(simMsArg ?? 3000);

// ---------- image and symbols ----------
function loadHex(path) {
  const flash = new Uint8Array(0x8000);
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

/** Minimal ELF32 little-endian symbol table reader (function symbols only). */
function elfFunctions(path) {
  const buf = readFileSync(path);
  const shoff = buf.readUInt32LE(0x20);
  const shentsize = buf.readUInt16LE(0x2e);
  const shnum = buf.readUInt16LE(0x30);
  const sections = Array.from({ length: shnum }, (_, i) => {
    const o = shoff + i * shentsize;
    return { type: buf.readUInt32LE(o + 4), offset: buf.readUInt32LE(o + 16), size: buf.readUInt32LE(o + 20), link: buf.readUInt32LE(o + 24) };
  });
  const symtab = sections.find((s) => s.type === 2);
  if (!symtab) return {};
  const strtab = sections[symtab.link];
  const out = {};
  for (let o = symtab.offset; o < symtab.offset + symtab.size; o += 16) {
    const nameOff = buf.readUInt32LE(o);
    const value = buf.readUInt32LE(o + 4);
    const info = buf[o + 12];
    if ((info & 0xf) !== 2) continue; // STT_FUNC
    let end = strtab.offset + nameOff;
    while (buf[end]) end++;
    out[buf.toString("latin1", strtab.offset + nameOff, end)] = value;
  }
  return out;
}

// ---------- Uno hardware ----------
const PORTS = [
  { name: "B", cfg: portBConfig, pins: [8, 9, 10, 11, 12, 13, null, null] },
  { name: "C", cfg: portCConfig, pins: [14, 15, 16, 17, 18, 19, null, null] },
  { name: "D", cfg: portDConfig, pins: [0, 1, 2, 3, 4, 5, 6, 7] },
];
const ADCSRA = 0x7a, ADMUX = 0x7c, ADSC = 0x40;
const PWM = [ // TCCRxA address, COMx1 bit, OCR address, pin
  { tccr: 0x44, bit: 7, ocr: 0x47, pin: 6 }, { tccr: 0x44, bit: 5, ocr: 0x48, pin: 5 },
  { tccr: 0x80, bit: 7, ocr: 0x88, pin: 9 }, { tccr: 0x80, bit: 5, ocr: 0x8a, pin: 10 },
  { tccr: 0xb0, bit: 7, ocr: 0xb3, pin: 11 }, { tccr: 0xb0, bit: 5, ocr: 0xb4, pin: 3 },
];
const PWM_PINS = new Set(PWM.map((p) => p.pin));
const MODE = ["INPUT", "OUTPUT", "INPUT_PULLUP"];

// ---------- instruction decoding helpers ----------
const isTwoWord = (op) => (op & 0xfe0f) === 0x9000 || (op & 0xfe0f) === 0x9200 || (op & 0xfe0e) === 0x940e || (op & 0xfe0e) === 0x940c;
/** Bit index of an SBI/CBI/SBIS/SBIC opcode, else undefined. */
function ioBitOpcodeBit(op) {
  const hi = op & 0xff00;
  return hi === 0x9a00 || hi === 0x9800 || hi === 0x9b00 || hi === 0x9900 ? op & 7 : undefined;
}
/** Destination register of a load (IN, LDS, LD X/Y/Z, LDD), else undefined. */
function loadDest(op) {
  if ((op & 0xf800) === 0xb000) return (op & 0x1f0) >> 4; // IN
  if ((op & 0xfe00) === 0x9000) return (op & 0x1f0) >> 4; // LDS, LD X/Y/Z with pre/post
  if ((op & 0xd200) === 0x8000) return (op & 0x1f0) >> 4; // LDD Y/Z+q
  return undefined;
}
/** Source register of a store (OUT, STS, ST X/Y/Z, STD), else undefined. */
function storeSrc(op) {
  if ((op & 0xf800) === 0xb800) return (op & 0x1f0) >> 4; // OUT
  if ((op & 0xfe00) === 0x9200) return (op & 0x1f0) >> 4; // STS, ST X/Y/Z
  if ((op & 0xd200) === 0x8200) return (op & 0x1f0) >> 4; // STD
  return undefined;
}
/** Mask applied to `reg` by an OR/ORI (set) or AND/ANDI (clear) opcode. */
function maskFromModifier(op, reg, data) {
  if ((op & 0xf000) === 0x6000 && ((op & 0xf0) >> 4) + 16 === reg) return { set: (op & 0xf) | ((op & 0xf00) >> 4) }; // ORI
  if ((op & 0xf000) === 0x7000 && ((op & 0xf0) >> 4) + 16 === reg) return { clear: ~((op & 0xf) | ((op & 0xf00) >> 4)) & 0xff }; // ANDI
  const d = (op & 0x1f0) >> 4, r = (op & 0xf) | ((op & 0x200) >> 5);
  if ((op & 0xfc00) === 0x2800 && (d === reg || r === reg)) return { set: data[d === reg ? r : d] }; // OR
  if ((op & 0xfc00) === 0x2000 && (d === reg || r === reg)) return { clear: ~data[d === reg ? r : d] & 0xff }; // AND
  return undefined;
}
const bitsOf = (mask) => [0, 1, 2, 3, 4, 5, 6, 7].filter((b) => mask & (1 << b));

// ---------- one emulation run ----------
function emulate(hexPath, { observeRegisters, symbols }) {
  const prog = loadHex(hexPath);
  const cpu = new CPU(prog, 2048);
  new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
  const usart = new AVRUSART(cpu, usart0Config, CLOCK);
  const ports = PORTS.map((p) => ({ ...p, io: new AVRIOPort(cpu, p.cfg) }));
  const adc = new AVRADC(cpu, adcConfig);
  for (let ch = 0; ch < 8; ch++) adc.channelValues[ch] = 2.5;
  let serial = "";
  usart.onByteTransmit = (b) => { serial += String.fromCharCode(b); };
  const rx = [];

  // Pull-up and external drive as in the proposal prototype.
  const external = new Map();
  for (const p of ports) {
    p.io.addListener(() => {
      const ddr = cpu.data[p.cfg.DDR], out = cpu.data[p.cfg.PORT];
      for (let bit = 0; bit < 8; bit++) {
        const pin = p.pins[bit];
        if (pin == null || ddr & (1 << bit)) continue;
        p.io.setPin(bit, external.has(pin) ? external.get(pin) : Boolean(out & (1 << bit)));
      }
    });
  }
  const drive = (pin, level) => {
    external.set(pin, level);
    const p = ports.find((q) => q.pins.includes(pin));
    const bit = p.pins.indexOf(pin);
    if (!(cpu.data[p.cfg.DDR] & (1 << bit))) p.io.setPin(bit, level);
  };
  const ms = (t) => Math.round(t * CLOCK / 1000);
  const stimuli = [
    [100, () => "5\n"], [600, () => "12\n"], [1100, () => "a\n"], [1600, () => "3\n"],
  ].map(([t, f]) => ({ at: ms(t), run: () => { for (const c of f()) rx.push(c.charCodeAt(0)); } }));
  for (const [t, level] of [[300, false], [500, true], [900, false], [1200, true], [2000, false], [2400, true]]) {
    stimuli.push({ at: ms(t), run: () => { for (let pin = 2; pin <= 19; pin++) drive(pin, level); } });
  }
  stimuli.push({ at: ms(800), run: () => { for (let ch = 0; ch < 8; ch++) adc.channelValues[ch] = 4.0; } });
  stimuli.sort((a, b) => a.at - b.at);

  // ---- observation ----
  const levels = { R0: new Map(), R1: new Map(), R2: new Map() };
  const portOnly = { R0: new Set(), R1: new Set() };
  const record = (level, op, pin, mode) => {
    const key = `${op}:${pin}`;
    const m = levels[level];
    if (!m.has(key)) m.set(key, { modes: new Set(), firstCycle: cpu.cycles });
    if (mode) m.get(key).modes.add(mode);
  };
  const recordR12 = (op, pin, mode) => { record("R1", op, pin, mode); record("R2", op, pin, mode); };
  const pending = { R0: [], R1: [] }; // DDR writes of pinMode(INPUT|INPUT_PULLUP) awaiting the PORT write
  let pendingOutputPwm = []; // R2: pinMode(OUTPUT) on PWM pins waiting for analogWrite evidence
  let readWatch = null; // { reg, port, left }
  const WINDOW = 24; // cycles between DDR and PORT write inside pinMode

  const flushPending = (force) => {
    for (const level of ["R0", "R1"]) {
      pending[level] = pending[level].filter((p) => {
        if (!force && cpu.cycles - p.cycle <= WINDOW) return true;
        if (!p.bits) portOnly[level].add(`pinMode:${p.port.name}`);
        for (const bit of bitsOf(p.bits)) {
          const pin = p.port.pins[bit];
          if (pin == null) continue;
          if (level === "R0") record("R0", "pinMode", pin, "INPUT");
          else recordR12("pinMode", pin, "INPUT");
        }
        return false;
      });
    }
    pendingOutputPwm = pendingOutputPwm.filter((p) => {
      if (!force && cpu.cycles - p.cycle <= 200) return true;
      record("R2", "pinMode", p.pin, "OUTPUT");
      return false;
    });
  };
  // Arduino calls touch exactly one bit; a decoded multi-bit mask is the old
  // register value rather than the pin mask and counts as port-only.
  const singleBit = (m) => (m && bitsOf(m.set | m.clear).length === 1 ? m : undefined);
  const decodeStoreMask = () => singleBit(decodeStoreMaskRaw());
  const decodeStoreMaskRaw = () => {
    const op = cpu.progMem[cpu.pc];
    const bit = ioBitOpcodeBit(op);
    if (bit !== undefined) return { set: (op & 0xff00) === 0x9a00 ? 1 << bit : 0, clear: (op & 0xff00) === 0x9800 ? 1 << bit : 0 };
    const src = storeSrc(op);
    if (src === undefined) return undefined;
    for (let back = 1; back <= 3; back++) {
      const m = maskFromModifier(cpu.progMem[cpu.pc - back], src, cpu.data);
      if (m) return { set: m.set ?? 0, clear: m.clear ?? 0 };
    }
    return undefined;
  };
  const chainWrite = (addr, fn) => {
    const prev = cpu.writeHooks[addr];
    cpu.writeHooks[addr] = (value, old, a, mask) => { fn(value, old); return prev ? prev(value, old, a, mask) : undefined; };
  };
  const chainRead = (addr, fn) => {
    const prev = cpu.readHooks[addr];
    cpu.readHooks[addr] = (a) => { fn(); return prev ? prev(a) : cpu.data[a]; };
  };

  if (observeRegisters) {
    for (const port of ports) {
      chainWrite(port.cfg.DDR, (value, old) => {
        flushPending(false);
        const changed = (value ^ old) & 0xff;
        // R0: only bit changes.
        for (const bit of bitsOf(changed & value)) if (port.pins[bit] != null) record("R0", "pinMode", port.pins[bit], "OUTPUT");
        if (changed & ~value) pending.R0.push({ port, bits: changed & ~value & 0xff, cycle: cpu.cycles });
        else if (!changed) portOnly.R0.add(`pinMode:${port.name}`);
        // R1: changes, else the decoded single-bit mask.
        const decoded = changed ? undefined : decodeStoreMask();
        const setBits = changed ? changed & value : decoded?.set ?? 0;
        for (const bit of bitsOf(setBits)) {
          const pin = port.pins[bit];
          if (pin == null) continue;
          record("R1", "pinMode", pin, "OUTPUT");
          if (PWM_PINS.has(pin)) pendingOutputPwm.push({ pin, cycle: cpu.cycles });
          else record("R2", "pinMode", pin, "OUTPUT");
        }
        // No bit set: pinMode(INPUT|INPUT_PULLUP). The pin may stay unknown
        // until the PORT write that follows within a few cycles.
        if (!setBits) pending.R1.push({ port, bits: changed ? changed & ~value & 0xff : decoded?.clear ?? 0, cycle: cpu.cycles });
      });
      chainWrite(port.cfg.PORT, (value, old) => {
        const changed = (value ^ old) & 0xff;
        const modeOf = (bit) => (value & (1 << bit) ? "INPUT_PULLUP" : "INPUT");
        const take = (list) => {
          const hit = list.find((p) => p.port === port && cpu.cycles - p.cycle <= WINDOW);
          if (hit) list.splice(list.indexOf(hit), 1);
          return hit;
        };
        // R0
        const p0 = take(pending.R0);
        if (p0) for (const bit of bitsOf(p0.bits)) record("R0", "pinMode", port.pins[bit], modeOf(bit));
        for (const bit of bitsOf(changed & ~(p0?.bits ?? 0))) if (port.pins[bit] != null) record("R0", "digitalWrite", port.pins[bit]);
        if (!changed && !p0) portOnly.R0.add(`digitalWrite:${port.name}`);
        // R1/R2: the PORT write of pinMode itself is not a digitalWrite.
        const p1 = take(pending.R1);
        if (p1) {
          const bits = p1.bits || (bitsOf(changed).length === 1 ? changed : 0);
          if (!bits) portOnly.R1.add(`pinMode:${port.name}`);
          for (const bit of bitsOf(bits)) if (port.pins[bit] != null) recordR12("pinMode", port.pins[bit], modeOf(bit));
          return;
        }
        flushPending(false);
        const m = changed ? { set: changed, clear: 0 } : decodeStoreMask();
        if (m) for (const bit of bitsOf(m.set | m.clear)) { if (port.pins[bit] != null) recordR12("digitalWrite", port.pins[bit]); }
        else portOnly.R1.add(`digitalWrite:${port.name}`);
      });
      chainRead(port.cfg.PIN, () => {
        portOnly.R0.add(`digitalRead:${port.name}`);
        const op = cpu.progMem[cpu.pc];
        const bit = ioBitOpcodeBit(op);
        if (bit !== undefined) { const pin = port.pins[bit]; if (pin != null) recordR12("digitalRead", pin); return; }
        const reg = loadDest(op);
        if (reg !== undefined) readWatch = { reg, port, left: 6, pc: cpu.pc + (isTwoWord(op) ? 2 : 1) };
        else portOnly.R1.add(`digitalRead:${port.name}`);
      });
    }
    chainWrite(ADCSRA, (value) => {
      if (!(value & ADSC)) return;
      const pin = 14 + (cpu.data[ADMUX] & 0x07);
      record("R0", "analogRead", pin); recordR12("analogRead", pin);
    });
    for (const ch of PWM) {
      chainWrite(ch.tccr, (value, old) => {
        if ((value & ~old) & (1 << ch.bit)) {
          record("R0", "analogWrite", ch.pin); recordR12("analogWrite", ch.pin);
          pendingOutputPwm = pendingOutputPwm.filter((p) => p.pin !== ch.pin);
        }
      });
      chainWrite(ch.ocr, () => {
        if (cpu.data[ch.tccr] & (1 << ch.bit)) {
          record("R0", "analogWrite", ch.pin); recordR12("analogWrite", ch.pin);
          pendingOutputPwm = pendingOutputPwm.filter((p) => p.pin !== ch.pin);
        }
      });
    }
  }

  // ---- symbol reference (entry hooks) ----
  const truth = new Map();
  const entries = new Map();
  if (symbols) {
    for (const fn of ["pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite"]) {
      if (symbols[fn] !== undefined) entries.set(symbols[fn] >> 1, fn);
    }
  }
  let insideSp = null;

  // ---- run ----
  const end = SIM_MS * (CLOCK / 1000);
  let next = 0, instructions = 0;
  const started = performance.now();
  while (cpu.cycles < end) {
    while (next < stimuli.length && cpu.cycles >= stimuli[next].at) stimuli[next++].run();
    if (rx.length && !usart.rxBusy) usart.writeByte(rx.shift());
    for (let i = 0; i < 1000; i++) {
      if (entries.size) {
        if (insideSp !== null && cpu.SP > insideSp) insideSp = null;
        const fn = entries.get(cpu.pc);
        if (fn && insideSp === null) {
          insideSp = cpu.SP;
          const r24 = cpu.data[24], r22 = cpu.data[22];
          let pin = r24, mode;
          if (fn === "analogRead") pin = r24 < 14 ? r24 + 14 : r24;
          if (fn === "pinMode") mode = MODE[r22] ?? String(r22);
          const key = `${fn}:${pin}`;
          if (!truth.has(key)) truth.set(key, { modes: new Set(), firstCycle: cpu.cycles });
          if (mode) truth.get(key).modes.add(mode);
        }
      }
      if (readWatch) {
        if (cpu.pc >= readWatch.pc) {
          const op = cpu.progMem[cpu.pc];
          let mask;
          if ((op & 0xfc00) === 0xfc00 && ((op & 0x1f0) >> 4) === readWatch.reg) mask = 1 << (op & 7); // SBRC/SBRS
          else { const m = maskFromModifier(op, readWatch.reg, cpu.data); if (m?.clear !== undefined) mask = ~m.clear & 0xff; }
          if (mask !== undefined) {
            const bits = bitsOf(mask);
            if (bits.length === 1 && readWatch.port.pins[bits[0]] != null) recordR12("digitalRead", readWatch.port.pins[bits[0]]);
            else portOnly.R1.add(`digitalRead:${readWatch.port.name}`);
            readWatch = null;
          } else if (--readWatch.left <= 0) { portOnly.R1.add(`digitalRead:${readWatch.port.name}`); readWatch = null; }
        }
      }
      avrInstruction(cpu);
      cpu.tick();
      instructions++;
    }
  }
  flushPending(true);
  const wallMs = performance.now() - started;
  const toObj = (m) => Object.fromEntries([...m].map(([k, v]) => [k, { modes: [...v.modes], firstMs: +(v.firstCycle / CLOCK * 1000).toFixed(2) }]));
  return {
    serial: serial.replaceAll("\r", ""),
    realTimeFactor: +(SIM_MS / wallMs).toFixed(2),
    instructions,
    levels: observeRegisters ? { R0: toObj(levels.R0), R1: toObj(levels.R1), R2: toObj(levels.R2) } : undefined,
    portOnly: observeRegisters ? { R0: [...portOnly.R0], R1: [...portOnly.R1] } : undefined,
    truth: symbols ? toObj(truth) : undefined,
  };
}

// ---------- main ----------
const results = {};
for (const name of readdirSync(buildDir).filter((d) => !d.endsWith(".log")).sort()) {
  const lto = join(buildDir, name, `${name}.ino`);
  const ref = join(noLtoDir, name, `${name}.ino`);
  const ltoSymbols = elfFunctions(`${lto}.elf`);
  const ioSymbolsLto = ["pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite"].filter((f) => f in ltoSymbols);
  const observed = emulate(`${lto}.hex`, { observeRegisters: true });
  const bare = emulate(`${lto}.hex`, { observeRegisters: false });
  const reference = emulate(`${ref}.hex`, { observeRegisters: false, symbols: elfFunctions(`${ref}.elf`) });
  results[name] = {
    ioSymbolsLto,
    hookCostRatio: +(bare.realTimeFactor / observed.realTimeFactor).toFixed(3),
    realTimeFactorBare: bare.realTimeFactor,
    realTimeFactorObserved: observed.realTimeFactor,
    sameSerial: observed.serial === reference.serial,
    levels: observed.levels,
    portOnly: observed.portOnly,
    truth: reference.truth,
  };
  console.log(name, JSON.stringify({ truth: Object.keys(reference.truth), R1: Object.keys(observed.levels.R1), portOnly: observed.portOnly.R1 }));
}
writeFileSync(outFile, JSON.stringify({ simMs: SIM_MS, avr8js: "0.21.1", results }, null, 2));

import type { CPU } from "avr8js";
import type { ImageSymbols } from "../image/simulation-image";
import type { Machine } from "../machine";
import {
  bitsOf, ioBitInstructionBit, isSetBitInstruction, isTwoWordInstruction, loadDestination, modifierMask, singleBit, skipBitTest, storeSource,
} from "./avr-decode";
import { chainWrite } from "./hooks";
import type { PinMode } from "./pin-model";

export type IoFunction = "pinMode" | "digitalWrite" | "digitalRead" | "analogRead" | "analogWrite";

/** One runtime finding of the I/O registry (origin "runtime"). */
export interface IoUsage {
  readonly pin: number;
  readonly fn: IoFunction;
  readonly mode?: PinMode;
}

interface PortObservation {
  readonly name: string;
  readonly pins: ReadonlyArray<number | undefined>;
}

interface PendingInput {
  readonly port: PortObservation;
  readonly bits: number;
  readonly cycle: number;
}

/** A PORT write this many cycles after a DDR write without set bit belongs to pinMode(INPUT…). */
const PIN_MODE_WINDOW_CYCLES = 24;
/** A COM bit this many cycles after pinMode(OUTPUT) on a PWM pin means analogWrite did the pinMode. */
const ANALOG_WRITE_WINDOW_CYCLES = 200;
/** Instructions after a PIN read in which the masking instruction is expected. */
const READ_WINDOW_INSTRUCTIONS = 6;
const ADSC = 0x40;
const MODES: readonly PinMode[] = ["INPUT", "OUTPUT", "INPUT_PULLUP"];
const IO_FUNCTIONS: readonly IoFunction[] = ["pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite"];

/**
 * Runtime I/O detection (plan 4.9, P1.9, spike P0.4 level R2): register
 * hooks on DDR, PORT, PIN, ADCSRA and the PWM timer registers, refined by
 * decoding the accessing instruction. Only pin-exact findings are reported,
 * each on its first occurrence per pin and function or with a new pinMode
 * mode. Entry hooks on the five Arduino functions are used only when the
 * image carries their symbols (after LTO it rarely does).
 */
export class IoUsageObserver {
  /** True while the run loop must call `step()` before each instruction. */
  needsStep = false;
  private readonly known = new Map<string, Set<PinMode | undefined>>();
  private fresh: IoUsage[] = [];
  private pendingInputs: PendingInput[] = [];
  private pendingOutputs: Array<{ pin: number; cycle: number }> = [];
  private readWatch: { register: number; port: PortObservation; fromPc: number; left: number } | undefined;
  private readonly entries = new Map<number, IoFunction>();
  private insideCallSp: number | undefined;

  constructor(private readonly machine: Machine, symbols?: ImageSymbols) {
    this.observePorts();
    this.observeAdc();
    this.observePwm();
    for (const fn of IO_FUNCTIONS) {
      const address = symbols?.functions[fn];
      if (address !== undefined) this.entries.set(address >> 1, fn);
    }
    this.updateNeedsStep();
  }

  /** New findings since the previous call. */
  takeUsages(): IoUsage[] {
    this.flushPending(false);
    const usages = this.fresh;
    this.fresh = [];
    return usages;
  }

  /** All findings so far. */
  snapshot(): IoUsage[] {
    this.flushPending(false);
    return [...this.known].flatMap(([key, modes]) => {
      const [fn, pin] = key.split(":");
      return [...modes].map((mode) => ({ pin: Number(pin), fn: fn as IoFunction, ...(mode ? { mode } : {}) }));
    });
  }

  /** Called before each instruction while `needsStep`. */
  step(): void {
    const { cpu } = this.machine;
    if (this.readWatch) this.stepReadWatch(cpu);
    if (this.entries.size > 0) this.stepEntryHooks(cpu);
  }

  private record(fn: IoFunction, pin: number | undefined, mode?: PinMode): void {
    if (pin === undefined) return;
    const key = `${fn}:${pin}`;
    const modes = this.known.get(key) ?? new Set();
    if (modes.has(mode)) return;
    modes.add(mode);
    this.known.set(key, modes);
    this.fresh.push({ pin, fn, ...(mode ? { mode } : {}) });
  }

  private observePorts(): void {
    const { cpu, board, peripherals } = this.machine;
    for (const [name, io] of peripherals.ports) {
      const pins: Array<number | undefined> = Array.from({ length: 8 });
      for (const pin of board.pins) if (pin.port?.port === name) pins[pin.port.bit] = pin.pin;
      const port = { name, pins };
      const { DDR, PORT, PIN } = io.portConfig;
      chainWrite(cpu, DDR, (value, old) => this.onDdrWrite(port, value, old));
      chainWrite(cpu, PORT, (value, old) => this.onPortWrite(port, value, old));
      const previousRead = cpu.readHooks[PIN];
      cpu.readHooks[PIN] = (address) => {
        this.onPinRead(port);
        return previousRead ? previousRead(address) : cpu.data[address];
      };
    }
  }

  private onDdrWrite(port: PortObservation, value: number, old: number): void {
    this.flushPending(false);
    const changed = (value ^ old) & 0xff;
    const decoded = changed ? undefined : this.decodeStore();
    const setBits = changed ? changed & value : decoded?.set ?? 0;
    for (const bit of bitsOf(setBits)) {
      const pin = port.pins[bit];
      if (pin !== undefined && this.isPwmPin(pin)) this.pendingOutputs.push({ pin, cycle: this.machine.cpu.cycles });
      else this.record("pinMode", pin, "OUTPUT");
    }
    if (!setBits) {
      const bits = changed ? changed & ~value & 0xff : decoded?.clear ?? 0;
      this.pendingInputs.push({ port, bits, cycle: this.machine.cpu.cycles });
    }
  }

  private onPortWrite(port: PortObservation, value: number, old: number): void {
    const changed = (value ^ old) & 0xff;
    const pending = this.pendingInputs.find((p) => p.port === port && this.machine.cpu.cycles - p.cycle <= PIN_MODE_WINDOW_CYCLES);
    if (pending) {
      this.pendingInputs = this.pendingInputs.filter((p) => p !== pending);
      const bits = pending.bits || (singleBit(changed) === undefined ? 0 : changed);
      for (const bit of bitsOf(bits)) this.record("pinMode", port.pins[bit], value & (1 << bit) ? "INPUT_PULLUP" : "INPUT");
      return;
    }
    this.flushPending(false);
    const decoded = changed ? undefined : this.decodeStore();
    const bits = changed || (decoded ? decoded.set | decoded.clear : 0);
    for (const bit of bitsOf(bits)) this.record("digitalWrite", port.pins[bit]);
  }

  private onPinRead(port: PortObservation): void {
    const { cpu } = this.machine;
    const opcode = cpu.progMem[cpu.pc];
    const bit = ioBitInstructionBit(opcode);
    if (bit !== undefined) {
      this.record("digitalRead", port.pins[bit]);
      return;
    }
    const register = loadDestination(opcode);
    if (register === undefined) return;
    this.readWatch = { register, port, fromPc: cpu.pc + (isTwoWordInstruction(opcode) ? 2 : 1), left: READ_WINDOW_INSTRUCTIONS };
    this.updateNeedsStep();
  }

  private stepReadWatch(cpu: CPU): void {
    const watch = this.readWatch;
    if (!watch || cpu.pc < watch.fromPc) return;
    const opcode = cpu.progMem[cpu.pc];
    const tested = skipBitTest(opcode, watch.register);
    const masked = modifierMask(opcode, watch.register, cpu.data);
    const mask = tested === undefined ? masked && (~masked.clear & 0xff) : 1 << tested;
    if (mask) {
      const bit = singleBit(mask);
      if (bit !== undefined) this.record("digitalRead", watch.port.pins[bit]);
      this.readWatch = undefined;
    } else if (--watch.left <= 0) {
      this.readWatch = undefined;
    }
    this.updateNeedsStep();
  }

  private stepEntryHooks(cpu: CPU): void {
    if (this.insideCallSp !== undefined && cpu.SP > this.insideCallSp) this.insideCallSp = undefined;
    const fn = this.entries.get(cpu.pc);
    if (!fn || this.insideCallSp !== undefined) return;
    this.insideCallSp = cpu.SP; // calls made inside this function do not count
    const pin = cpu.data[24];
    if (fn === "pinMode") this.record(fn, pin, MODES[cpu.data[22]]);
    else if (fn === "analogRead") this.record(fn, this.analogPin(this.channelOfArgument(pin)));
    else this.record(fn, pin);
  }

  private observeAdc(): void {
    const { cpu, mcu } = this.machine;
    const { ADCSRA, channel } = mcu.adcRegisters;
    chainWrite(cpu, ADCSRA, (value) => {
      if (value & ADSC) this.record("analogRead", this.analogPin(channel(cpu.data)));
    });
  }

  /** `analogRead(x)` takes a channel number or the pin number of an analog input (A0 = 14 on the Uno, 54 on the Mega). */
  private channelOfArgument(argument: number): number {
    return this.machine.board.pins.find((pin) => pin.pin === argument)?.adcChannel ?? argument;
  }

  private analogPin(channel: number): number | undefined {
    return this.machine.board.pins.find((pin) => pin.adcChannel === channel)?.pin;
  }

  private observePwm(): void {
    const { cpu, board, mcu } = this.machine;
    for (const pin of board.pins) {
      if (!pin.pwm) continue;
      const timer = mcu.timerRegisters[pin.pwm.timer];
      const comBit = { A: 7, B: 5, C: 3 }[pin.pwm.channel];
      const ocr = { A: timer.OCRA, B: timer.OCRB, C: timer.OCRC }[pin.pwm.channel];
      const onAnalogWrite = () => {
        this.pendingOutputs = this.pendingOutputs.filter((p) => p.pin !== pin.pin);
        this.record("analogWrite", pin.pin);
      };
      chainWrite(cpu, timer.TCCRA, (value, old) => {
        if (value & ~old & (1 << comBit)) onAnalogWrite();
      });
      chainWrite(cpu, ocr, () => {
        if (cpu.data[timer.TCCRA] & (1 << comBit)) onAnalogWrite();
      });
    }
  }

  private isPwmPin(pin: number): boolean {
    return this.machine.board.pins.some((p) => p.pin === pin && p.pwm);
  }

  /** Single-bit mask of the store instruction being executed (spike P0.4: multi-bit masks are old values). */
  private decodeStore(): { set: number; clear: number } | undefined {
    const { cpu } = this.machine;
    const opcode = cpu.progMem[cpu.pc];
    const bit = ioBitInstructionBit(opcode);
    if (bit !== undefined) return isSetBitInstruction(opcode) ? { set: 1 << bit, clear: 0 } : { set: 0, clear: 1 << bit };
    const register = storeSource(opcode);
    if (register === undefined) return undefined;
    for (let back = 1; back <= 3; back++) {
      const mask = modifierMask(cpu.progMem[cpu.pc - back], register, cpu.data);
      if (mask) return singleBit(mask.set | mask.clear) === undefined ? undefined : mask;
    }
    return undefined;
  }

  /** Resolves pinMode findings whose window has passed. */
  private flushPending(force: boolean): void {
    const now = this.machine.cpu.cycles;
    this.pendingInputs = this.pendingInputs.filter((p) => {
      if (!force && now - p.cycle <= PIN_MODE_WINDOW_CYCLES) return true;
      for (const bit of bitsOf(p.bits)) this.record("pinMode", p.port.pins[bit], "INPUT");
      return false;
    });
    this.pendingOutputs = this.pendingOutputs.filter((p) => {
      if (!force && now - p.cycle <= ANALOG_WRITE_WINDOW_CYCLES) return true;
      this.record("pinMode", p.pin, "OUTPUT");
      return false;
    });
  }

  private updateNeedsStep(): void {
    this.needsStep = this.readWatch !== undefined || this.entries.size > 0;
  }
}

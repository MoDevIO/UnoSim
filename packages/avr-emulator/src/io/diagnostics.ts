import type { CPU } from "avr8js";
import type { ImageSymbols } from "../image/simulation-image";
import type { Machine } from "../machine";
import { ramEnd } from "../mcu/memory";
import { chainWrite } from "./hooks";

/** A run-time condition the emulator reports (plan P1.10); other memory errors go unnoticed, as on the board. */
export type Diagnostic =
  | { readonly kind: "stack-overflow"; readonly region: "bss" | "heap"; readonly sp: number; readonly limit: number }
  | { readonly kind: "pc-out-of-program"; readonly pc: number; readonly programBytes: number }
  | { readonly kind: "watchdog-reset" }
  | { readonly kind: "sleep-interrupts-disabled"; readonly pc: number };

export type DiagnosticKind = Diagnostic["kind"];

const SPL = 0x5d;
const SLEEP_OPCODE = 0x9588;

/**
 * Detects the cases of plan P1.10. `check()` runs at the end of every chunk
 * of the run loop and on writes to SPL; PUSH, CALL and interrupts change SP
 * without a hook, so an overflow that returns before the next check stays
 * unnoticed. Each condition is reported once until it has ended (stack back
 * above the limit, PC back in the program, SLEEP enable cleared); a watchdog
 * reset is reported with every reset and sets `resetPending`, because avr8js
 * resets only PC and SP and the run loop must restart the whole machine.
 */
export class Diagnostics {
  /** True while the run loop must call `step()` before each instruction (sleep enabled). */
  needsStep = false;
  /** Set by a watchdog reset; the run loop replaces the machine. */
  resetPending = false;
  private readonly active = new Set<DiagnosticKind>();
  private readonly programWords: number;

  constructor(
    private readonly machine: Machine,
    private readonly image: { readonly symbols: ImageSymbols; readonly flashBytes: number },
    private readonly report: (diagnostic: Diagnostic) => void,
  ) {
    this.programWords = Math.ceil(image.flashBytes / 2);
    const { cpu, mcu } = machine;
    chainWrite(cpu, SPL, (value) => this.checkStack(((cpu.data[SPL + 1] << 8) | value) & 0xffff));
    const { register, mask } = mcu.sleepEnable;
    chainWrite(cpu, register, (value) => {
      this.needsStep = (value & mask) !== 0;
      if (!this.needsStep) this.clear("sleep-interrupts-disabled");
    });
    this.observeWatchdog(cpu);
  }

  /** Stack and program counter against their limits. */
  check(): void {
    const { cpu } = this.machine;
    this.checkStack(cpu.SP);
    if (cpu.pc >= this.programWords) this.raise({ kind: "pc-out-of-program", pc: cpu.pc * 2, programBytes: this.image.flashBytes });
    else this.clear("pc-out-of-program");
  }

  /** Called before each instruction while `needsStep`: SLEEP with global interrupts disabled. */
  step(): void {
    const { cpu } = this.machine;
    if (cpu.progMem[cpu.pc] === SLEEP_OPCODE && !cpu.interruptsEnabled) this.raise({ kind: "sleep-interrupts-disabled", pc: cpu.pc * 2 });
    else this.clear("sleep-interrupts-disabled");
  }

  private checkStack(sp: number): void {
    const { data } = this.image.symbols;
    const bssEnd = data.__bss_end;
    if (bssEnd === undefined) return; // without the symbol the stack check is off (plan P1.10)
    const heapEnd = this.heapEnd(bssEnd);
    const region = sp < bssEnd ? "bss" : "heap";
    const limit = region === "bss" ? bssEnd : heapEnd;
    if (sp < limit) this.raise({ kind: "stack-overflow", region, sp, limit });
    else this.clear("stack-overflow");
  }

  /** `__brkval` is non-zero once malloc has grown the heap; anything outside the SRAM is no heap end. */
  private heapEnd(bssEnd: number): number {
    const address = this.image.symbols.data.__brkval;
    if (address === undefined) return bssEnd;
    const { data } = this.machine.cpu;
    const brk = data[address] | (data[address + 1] << 8);
    return brk > bssEnd && brk <= ramEnd(this.machine.mcu.memory) ? brk : bssEnd;
  }

  /** Reports a diagnostic unless its condition was already reported and has not ended since. */
  private raise(diagnostic: Diagnostic): void {
    if (this.active.has(diagnostic.kind)) return;
    this.active.add(diagnostic.kind);
    this.report(diagnostic);
  }

  private clear(kind: DiagnosticKind): void {
    this.active.delete(kind);
  }

  private observeWatchdog(cpu: CPU): void {
    // In avr8js only the watchdog calls CPU.reset() after construction.
    const reset = cpu.reset.bind(cpu);
    cpu.reset = () => {
      reset();
      this.resetPending = true;
      this.report({ kind: "watchdog-reset" });
    };
  }
}

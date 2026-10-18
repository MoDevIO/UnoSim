import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DiagnosticEvent, Diagnostics, Emulator, buildSimulationImage, loadSimulationImage } from "../src/index";
import { FakeClock } from "./fake-clock";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

function emulatorFor(name: string, { elf = false } = {}): Emulator {
  const image = loadSimulationImage(
    buildSimulationImage({
      board: "uno",
      hex: fixture(`uno-${name}.hex`).toString("utf8"),
      ...(elf ? { elf: new Uint8Array(fixture(`uno-${name}.elf`)) } : {}),
    }),
  );
  return new Emulator(image, { clock: new FakeClock(), timeoutMs: 10_000 });
}

function diagnose(name: string, ms: number, options?: { elf?: boolean }): DiagnosticEvent[] {
  const emulator = emulatorFor(name, options);
  emulator.advance(ms);
  return emulator.takeDiagnostics();
}

describe("Diagnostics (plan P1.10)", () => {
  it("reports a stack that reaches into .bss once", () => {
    const events = diagnose("diag_stack_bss", 50, { elf: true });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "stack-overflow", region: "bss", limit: 0x361 });
    expect(events[0].kind === "stack-overflow" && events[0].sp).toBeLessThan(0x361);
  });

  it("reports a stack that reaches into the heap (__brkval) but not into .bss", () => {
    const events = diagnose("diag_stack_heap", 50, { elf: true });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "stack-overflow", region: "heap" });
    const { sp, limit } = events[0] as Extract<DiagnosticEvent, { kind: "stack-overflow" }>;
    expect(sp).toBeLessThan(limit);
    expect(sp).toBeGreaterThanOrEqual(0x113); // __bss_end
  });

  it("reports nothing for a modest recursion", () => {
    expect(diagnose("diag_stack_ok", 50, { elf: true })).toEqual([]);
  });

  it("skips the stack check without the __bss_end symbol", () => {
    expect(diagnose("diag_stack_bss", 50)).toEqual([]);
  });

  it("reports a jump into erased flash once", () => {
    const events = diagnose("diag_pc_erased", 20);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "pc-out-of-program" });
    const { pc, programBytes } = events[0] as Extract<DiagnosticEvent, { kind: "pc-out-of-program" }>;
    expect(pc).toBeGreaterThanOrEqual(programBytes);
  });

  it("reports a watchdog reset and restarts the whole machine, rate limited to once per second", () => {
    const emulator = emulatorFor("diag_watchdog");
    emulator.advance(100); // about six 15 ms periods
    const first = emulator.takeDiagnostics();

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "watchdog-reset" });
    expect(emulator.machine.cpu.cycles).toBeGreaterThan(0);
    emulator.advance(1100);
    expect(emulator.takeDiagnostics().map((e) => e.kind)).toEqual(["watchdog-reset"]);
  });

  it("reports SLEEP with global interrupts disabled", () => {
    const events = diagnose("diag_sleep_cli", 20);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "sleep-interrupts-disabled" });
  });

  it("stays silent for SLEEP with interrupts enabled", () => {
    expect(diagnose("diag_sleep_sei", 20)).toEqual([]);
  });

  it("documented limit: a stack dip between two checks goes unnoticed", () => {
    const image = loadSimulationImage(
      buildSimulationImage({ board: "uno", hex: fixture("uno-diag_stack_ok.hex").toString("utf8"), elf: new Uint8Array(fixture("uno-diag_stack_ok.elf")) }),
    );
    const emulator = new Emulator(image, { clock: new FakeClock(), timeoutMs: 10_000 });
    const { cpu } = emulator.machine;
    const reported: string[] = [];
    const diagnostics = new Diagnostics(emulator.machine, image, (d) => reported.push(d.kind));
    const ramEnd = cpu.SP;

    cpu.SP = 0x105; // PUSH/CALL/interrupts change SP without a hook
    cpu.SP = ramEnd;
    diagnostics.check();
    expect(reported).toEqual([]);

    cpu.SP = 0x105;
    diagnostics.check();
    expect(reported).toEqual(["stack-overflow"]);
    diagnostics.check();
    expect(reported).toEqual(["stack-overflow"]); // once while the condition lasts
    cpu.SP = ramEnd;
    diagnostics.check();
    cpu.SP = 0x105;
    diagnostics.check();
    expect(reported).toEqual(["stack-overflow", "stack-overflow"]); // reported again after it ended
  });
});

import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "@unosim/avr-emulator/protocol";
import { diagnosticLine } from "../../../../client/src/lib/runtime/diagnostic-lines";

const at = { simTimeMs: 12 };

describe("diagnosticLine (plan P3.6)", () => {
  it.each([
    [{ kind: "stack-overflow", region: "bss", sp: 0x1c0, limit: 0x1ec, ...at }, "--- Warning: the stack has grown into the global variables (SP 0x01C0, limit 0x01EC) ---\n"],
    [{ kind: "stack-overflow", region: "heap", sp: 0x300, limit: 0x400, ...at }, "--- Warning: the stack has grown into the heap (SP 0x0300, limit 0x0400) ---\n"],
    [{ kind: "pc-out-of-program", pc: 0x2000, programBytes: 100, ...at }, "--- Warning: the program counter left the program (address 0x2000) ---\n"],
    [{ kind: "watchdog-reset", ...at }, "--- The watchdog reset the board; the sketch starts again ---\n"],
    [{ kind: "sleep-interrupts-disabled", pc: 0x40, ...at }, "--- Warning: sleep with interrupts disabled, the board would never wake up (address 0x0040) ---\n"],
    [{ kind: "serial-input-discarded", port: 0, bytes: 3, ...at }, "--- Serial input discarded because the receiver was not enabled yet (Serial.begin() has not run) ---\n"],
  ] satisfies Array<[DiagnosticEvent, string]>)("words %j as a system line", (event, line) => {
    expect(diagnosticLine(event)).toBe(line);
  });
});

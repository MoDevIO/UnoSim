import type { DiagnosticEvent } from "@unosim/avr-emulator/protocol";

const hex = (value: number): string => `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;

const serialName = (port: number): string => (port === 0 ? "Serial" : "Serial" + port);

/** The system line for a diagnostic of the emulator, in the style of the server's lines (plan P3.6). */
export function diagnosticLine(event: DiagnosticEvent): string {
  switch (event.kind) {
    case "stack-overflow":
      return `--- Warning: the stack has grown into the ${event.region === "bss" ? "global variables" : "heap"} (SP ${hex(event.sp)}, limit ${hex(event.limit)}) ---\n`;
    case "pc-out-of-program":
      return `--- Warning: the program counter left the program (address ${hex(event.pc)}) ---\n`;
    case "watchdog-reset":
      return "--- The watchdog reset the board; the sketch starts again ---\n";
    case "sleep-interrupts-disabled":
      return `--- Warning: sleep with interrupts disabled, the board would never wake up (address ${hex(event.pc)}) ---\n`;
    case "serial-input-discarded":
      return `--- Serial input discarded because the receiver was not enabled yet (${serialName(event.port)}.begin() has not run) ---\n`;
  }
}

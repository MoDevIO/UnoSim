// Pure parts of the hardware recording tool (scripts/record-hardware.ts): no I/O, tested in tests/server.
import type { StimulusEvent } from "../packages/avr-emulator/src/index";

/** Toolchain a recording of a case of this board was built with, as `case.json` names it. */
export function recordingToolchain(board: string): string {
  return board === "attiny85" ? "arduino-cli 1.5.1, ATTinyCore 1.5.2 (avr-gcc of arduino:avr@1.8.8)" : "arduino-cli 1.5.1, arduino:avr@1.8.8";
}

/** Baud rate of `Serial.begin(n)` in the sketch; undefined if it never opens the port. */
export function baudOf(sketch: string): number | undefined {
  const match = /Serial\.begin\(\s*(\d+)\s*\)/.exec(sketch.replaceAll(/\/\/.*|\/\*[\s\S]*?\*\//g, ""));
  return match ? Number(match[1]) : undefined;
}

export interface ScheduledStep {
  /** Milliseconds after the reset of the board. */
  readonly atMs: number;
  /** Text to send to the board over serial, or undefined for a step the person performs. */
  readonly send?: string;
  /** What the person has to do at that moment. */
  readonly instruction?: string;
}

/** The stimuli of a case as steps: serial text is sent by the tool, pins and voltages are done by hand. */
export function stepsOf(events: readonly StimulusEvent[]): ScheduledStep[] {
  return events
    .map((event): ScheduledStep => {
      const [atMs, kind] = event;
      if (kind === "serial") return { atMs, send: event[2] };
      if (kind === "pin") return { atMs, instruction: `connect pin ${event[2]} to ${event[3] === 0 ? "GND (LOW)" : "5V (HIGH)"}` };
      return { atMs, instruction: `apply ${event[3]} V to ADC channel ${event[2]} (A${event[2]})` };
    })
    .sort((a, b) => a.atMs - b.atMs);
}

/** Serial text as expectations store it: CRLF read as LF. */
export const normalizeRecording = (text: string): string => text.replaceAll("\r\n", "\n");

/** Line-by-line differences between a recording and the expectation (empty = equal). */
export function lineDiff(expected: string, actual: string): string[] {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const problems: string[] = [];
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) problems.push(`line ${i + 1}: expected ${JSON.stringify(want[i])}, recorded ${JSON.stringify(got[i])}`);
  }
  return problems;
}

/** `case.json` after an accepted recording: class `hardware`, with where and how it was recorded. */
export function acceptedCase(caseFile: Record<string, unknown>, recordedOn: string, toolchain: string): Record<string, unknown> {
  const previous = typeof caseFile.basis === "string" ? caseFile.basis : "";
  return {
    ...caseFile,
    provenance: "hardware",
    recordedOn,
    toolchain,
    basis: `Recorded once on ${recordedOn} (serial output, ${toolchain}). Previous basis: ${previous}`,
  };
}

const NON_TEXT = /[^\u0020-\u007e\t\r\n]/;

/**
 * The USB bridge sometimes emits a few noise bytes when it resets the board, ahead of the sketch's first line.
 * Strips up to `maxBytes` leading bytes of a raw (latin1) recording if, and only if, the first line then matches
 * (per `matchesFirstLine`) and the stripped bytes contain at least one non-text byte. Returns what was stripped
 * so that the caller can report it.
 */
export function stripLeadingNoise(raw: string, matchesFirstLine: (line: string) => boolean, maxBytes = 8): { text: string; stripped: string } {
  const firstLine = (text: string): string => text.split(/\r?\n/, 1)[0] ?? "";
  if (matchesFirstLine(firstLine(raw))) return { text: raw, stripped: "" };
  for (let count = 1; count <= maxBytes && count < raw.length; count++) {
    const noise = raw.slice(0, count);
    if (NON_TEXT.test(noise) && !noise.includes("\n") && matchesFirstLine(firstLine(raw.slice(count)))) return { text: raw.slice(count), stripped: noise };
  }
  return { text: raw, stripped: "" };
}

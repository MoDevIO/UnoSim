import type { LoadedImage } from "../image/simulation-image";
import type { DiagnosticEvent } from "../runtime/emulator";
import { type RuntimeClock, systemClock } from "../runtime/clock";
import { Emulator } from "../runtime/emulator";
import type { IoUsage } from "../io/io-usage";
import type { Level, PinMode, PinSnapshot } from "../io/pin-model";

/**
 * Stimuli of a headless run (plan 7.4, `events` in `case.json`), each at a
 * simulated time in milliseconds. `adc` is the name used by the prototype
 * script for `adcVolts`; channels are ADC channels (0 = A0 on the Uno).
 */
export type StimulusEvent =
  | readonly [atMs: number, kind: "serial", text: string, port?: number]
  | readonly [atMs: number, kind: "pin", pin: number, level: Level]
  | readonly [atMs: number, kind: "adcVolts" | "adc", channel: number, volts: number];

/** State checks (plan 7.4, `expectState`), evaluated at a simulated time after the stimuli of that time. */
export type StateExpectation =
  | readonly [atMs: number, kind: "pin", pin: number, mode: PinMode, level: Level]
  | readonly [atMs: number, kind: "pwm", pin: number, duty: number]
  /** Result of the last conversion in ADCL/ADCH; valid only while ADMUX selects `channel`. */
  | readonly [atMs: number, kind: "adcRaw", channel: number, value: number];

export interface HeadlessOptions {
  /** Simulated run time in milliseconds. */
  readonly simMs: number;
  readonly events?: readonly StimulusEvent[];
  readonly expectState?: readonly StateExpectation[];
  /** EEPROM content to start with. */
  readonly eeprom?: Uint8Array;
  /** Longest stretch emulated in one go before output is collected (default 1000 ms). */
  readonly chunkMs?: number;
  /** Wall clock for the speed figure; the default is the system clock. */
  readonly clock?: RuntimeClock;
}

export interface StateCheck {
  readonly expectation: StateExpectation;
  readonly actual: string;
  readonly ok: boolean;
}

export interface HeadlessResult {
  readonly simTimeMs: number;
  readonly wallMs: number;
  /** Simulated per wall time; the real-time factor a device with this speed reaches at most. */
  readonly speed: number;
  /** Serial text by port, unmodified (the core's `println` ends lines with CRLF). */
  readonly serial: ReadonlyMap<number, string>;
  readonly pins: readonly PinSnapshot[];
  readonly usages: readonly IoUsage[];
  readonly diagnostics: readonly DiagnosticEvent[];
  readonly checks: readonly StateCheck[];
  readonly eeprom: Uint8Array;
}

/** Output is collected after at most this much simulated time, so long runs keep their buffers small. */
const DEFAULT_CHUNK_MS = 1000;

const isRecord = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** Checks a list of stimuli or expectations read from JSON; throws a RangeError naming the entry. */
export function parseStimuli(value: unknown, what: "events" | "expectState"): void {
  if (!isRecord(value)) throw new RangeError(`${what} must be an array`);
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry[0] !== "number" || !Number.isFinite(entry[0]) || entry[0] < 0 || typeof entry[1] !== "string") {
      throw new RangeError(`${what}[${index}] must start with a time in ms and a kind`);
    }
    const kinds = what === "events" ? EVENT_ARGUMENTS : STATE_ARGUMENTS;
    const expected = kinds[entry[1]];
    if (!expected) throw new RangeError(`${what}[${index}]: unknown kind "${entry[1]}"`);
    expected.forEach((type, position) => {
      const argument = entry[position + 2];
      if (typeof argument !== type && !(type === "number?" && (argument === undefined || typeof argument === "number"))) {
        throw new RangeError(`${what}[${index}]: argument ${position + 1} of "${entry[1]}" must be a ${type.replace("?", "")}`);
      }
    });
  });
}

const EVENT_ARGUMENTS: Record<string, readonly string[]> = {
  serial: ["string", "number?"],
  pin: ["number", "number"],
  adcVolts: ["number", "number"],
  adc: ["number", "number"],
};
const STATE_ARGUMENTS: Record<string, readonly string[]> = {
  pin: ["number", "string", "number"],
  pwm: ["number", "number"],
  adcRaw: ["number", "number"],
};

/**
 * Runs an image for `simMs` of simulated time as fast as possible, applies
 * the stimuli at their times and evaluates the state checks (plan P1.13).
 * Used by tests and the reference corpus; output is deterministic.
 */
export function runHeadless(image: LoadedImage, options: HeadlessOptions): HeadlessResult {
  const { simMs, events = [], expectState = [] } = options;
  if (!Number.isFinite(simMs) || simMs < 0) throw new RangeError(`invalid simMs ${simMs}`);
  if (options.chunkMs !== undefined && (Number.isNaN(options.chunkMs) || options.chunkMs <= 0)) throw new RangeError(`invalid chunkMs ${options.chunkMs}`);
  parseStimuli(events, "events");
  parseStimuli(expectState, "expectState");
  const clock = options.clock ?? systemClock();
  const emulator = new Emulator(image, { clock, timeoutMs: Number.MAX_SAFE_INTEGER, ...(options.eeprom ? { eeprom: options.eeprom } : {}) });
  const checks: StateCheck[] = [];
  const serial = new Map<number, string>();
  const usages: IoUsage[] = [];
  const diagnostics: DiagnosticEvent[] = [];
  const collect = () => {
    for (const { port, text } of emulator.takeSerialOutput()) serial.set(port, (serial.get(port) ?? "") + text);
    usages.push(...emulator.usage.takeUsages());
    diagnostics.push(...emulator.takeDiagnostics());
  };
  for (const event of events) emulator.at(event[0], () => applyEvent(emulator, event));
  for (const expectation of expectState) emulator.at(expectation[0], () => checks.push(evaluate(emulator, expectation)));

  const started = clock.now();
  let done = 0;
  do { // chunks keep the buffers small for long runs
    const step = Math.min(simMs - done, options.chunkMs ?? DEFAULT_CHUNK_MS);
    emulator.advance(step);
    collect();
    done += step;
  } while (done < simMs);
  const wallMs = clock.now() - started;
  collect();
  return {
    simTimeMs: emulator.simTimeMs,
    wallMs,
    speed: wallMs > 0 ? emulator.simTimeMs / wallMs : Number.POSITIVE_INFINITY,
    serial,
    pins: emulator.pins.snapshot(),
    usages,
    diagnostics,
    checks,
    eeprom: emulator.machine.eeprom,
  };
}

function applyEvent(emulator: Emulator, event: StimulusEvent): void {
  switch (event[1]) {
    case "serial":
      emulator.sendSerial(event[3] ?? 0, event[2]);
      break;
    case "pin":
      emulator.setDigital(event[2], event[3]);
      break;
    default:
      emulator.analog.setVolts(adcPin(emulator, event[2]), event[3]);
  }
}

function adcPin(emulator: Emulator, channel: number): number {
  const pin = emulator.machine.board.pins.find((p) => p.adcChannel === channel);
  if (!pin) throw new RangeError(`${emulator.machine.board.id} has no ADC channel ${channel}`);
  return pin.pin;
}

function evaluate(emulator: Emulator, expectation: StateExpectation): StateCheck {
  switch (expectation[1]) {
    case "pin": {
      const state = emulator.pins.state(expectation[2]);
      const actual = `${state.mode} ${state.level}`;
      return { expectation, actual, ok: state.mode === expectation[3] && state.level === expectation[4] };
    }
    case "pwm": {
      const duty = emulator.pins.state(expectation[2]).pwm;
      return { expectation, actual: duty === undefined ? "no PWM" : String(duty), ok: duty === expectation[3] };
    }
    default: {
      const { cpu, mcu } = emulator.machine;
      const { ADCL, ADCH, channel } = mcu.adcRegisters;
      const selected = channel(cpu.data);
      const value = cpu.data[ADCL] | (cpu.data[ADCH] << 8);
      return {
        expectation,
        actual: selected === expectation[2] ? String(value) : `channel ${selected} selected`,
        ok: selected === expectation[2] && value === expectation[3],
      };
    }
  }
}

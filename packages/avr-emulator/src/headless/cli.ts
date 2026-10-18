import { BOARD_HARDWARE_IDS, isBoardHardwareId, type BoardHardwareId } from "../boards/ids";
import { buildSimulationImage, loadSimulationImage } from "../image/simulation-image";
import { type HeadlessResult, type StateExpectation, type StimulusEvent, parseStimuli, runHeadless } from "./run-headless";

/** File and output access of the command line tool; the Node wiring lives in `scripts/emulate.ts`. */
export interface CliIo {
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  write(text: string): void;
}

const USAGE = `Usage: emulate <sketch.hex> [options]
  --elf <file>       matching ELF (symbols for stack and I/O detection)
  --board <id>       ${BOARD_HARDWARE_IDS.join(" | ")} (default: uno)
  --ms <n>           simulated milliseconds (default: 2000)
  --events <json>    [[ms, "serial", "text"], [ms, "pin", 2, 0], [ms, "adcVolts", 0, 2.77]]
  --case <file>      case.json of the reference corpus (board, simMs, events, expectState)
  --repeat <n>       run n times and report the median speed (performance measurement)
  --json             print the result as JSON
Exit code 1 if a state check fails.`;

interface Options {
  hex: string;
  elf?: string;
  board: BoardHardwareId;
  simMs: number;
  events: StimulusEvent[];
  expectState: StateExpectation[];
  repeat: number;
  json: boolean;
}

/** Runs the tool; returns the exit code. */
export function runCli(args: readonly string[], io: CliIo): number {
  try {
    const options = parseArguments(args, io);
    if (!options) {
      io.write(`${USAGE}\n`);
      return 2;
    }
    return execute(options, io);
  } catch (error) {
    io.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

function parseArguments(args: readonly string[], io: CliIo): Options | undefined {
  const values = new Map<string, string>();
  const positional: string[] = [];
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") flags.add("json");
    else if (arg === "--help") return undefined;
    else if (arg.startsWith("--")) {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      values.set(arg.slice(2), value);
    } else positional.push(arg);
  }
  if (positional.length !== 1) return undefined;
  const caseFile = values.get("case") ? (JSON.parse(io.readText(values.get("case") ?? "")) as Record<string, unknown>) : {};
  const board = String(values.get("board") ?? caseFile.board ?? "uno");
  if (!isBoardHardwareId(board)) throw new Error(`unknown board "${board}"`);
  const events = values.has("events") ? JSON.parse(values.get("events") ?? "[]") : (caseFile.events ?? []);
  const expectState = caseFile.expectState ?? [];
  parseStimuli(events, "events");
  parseStimuli(expectState, "expectState");
  const simMs = Number(values.get("ms") ?? caseFile.simMs ?? 2000);
  const repeat = Number(values.get("repeat") ?? 1);
  if (!Number.isFinite(simMs) || simMs < 0) throw new Error("--ms must be a non-negative number");
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a positive integer");
  return { hex: positional[0], ...(values.has("elf") ? { elf: values.get("elf") } : {}), board, simMs, events, expectState, repeat, json: flags.has("json") } as Options;
}

function execute(options: Options, io: CliIo): number {
  const image = loadSimulationImage(
    buildSimulationImage({
      board: options.board,
      hex: io.readText(options.hex),
      ...(options.elf ? { elf: io.readBytes(options.elf) } : {}),
    }),
  );
  const results: HeadlessResult[] = [];
  for (let run = 0; run < options.repeat; run++) {
    results.push(runHeadless(image, { simMs: options.simMs, events: options.events, expectState: options.expectState }));
  }
  const result = results[0];
  const speeds = results.map((r) => r.speed).sort((a, b) => a - b);
  io.write(options.json ? `${JSON.stringify(toJson(result, speeds), null, 2)}\n` : formatReport(result, speeds));
  return result.checks.every((check) => check.ok) ? 0 : 1;
}

const median = (sorted: readonly number[]): number => sorted[Math.floor(sorted.length / 2)];

function toJson(result: HeadlessResult, speeds: readonly number[]) {
  return {
    simTimeMs: result.simTimeMs,
    wallMs: result.wallMs,
    speed: median(speeds),
    runs: speeds.length,
    serial: Object.fromEntries(result.serial),
    pins: result.pins,
    usages: result.usages,
    diagnostics: result.diagnostics,
    checks: result.checks,
  };
}

/** Plain-text report of a run, ending with the speed figure. */
export function formatReport(result: HeadlessResult, speeds: readonly number[] = [result.speed]): string {
  const lines: string[] = [];
  for (const [port, text] of [...result.serial].sort((a, b) => a[0] - b[0])) {
    lines.push(`--- serial port ${port} ---`, text.replaceAll("\r\n", "\n").replace(/\n$/, ""));
  }
  const active = result.pins.filter((p) => p.mode !== "INPUT" || p.level !== 0 || p.pwm !== undefined);
  lines.push("--- pins (not plain inputs at LOW) ---", ...active.map((p) => `pin ${p.pin}: ${p.mode} ${p.level}${p.pwm === undefined ? "" : ` pwm ${p.pwm}`}`));
  lines.push("--- I/O usage ---", ...result.usages.map((u) => `${u.fn}(${u.pin}${u.mode ? `, ${u.mode}` : ""})`));
  if (result.diagnostics.length > 0) {
    lines.push("--- diagnostics ---", ...result.diagnostics.map((d) => `${d.simTimeMs.toFixed(1)} ms: ${d.kind}`));
  }
  if (result.checks.length > 0) {
    lines.push("--- state checks ---", ...result.checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${JSON.stringify(c.expectation)} (actual: ${c.actual})`));
  }
  const speed = median(speeds);
  lines.push(`--- ${result.simTimeMs.toFixed(0)} ms simulated, speed ${speed.toFixed(1)}x real time (${speeds.length} run${speeds.length > 1 ? "s" : ""}, median) ---`);
  return `${lines.join("\n")}\n`;
}

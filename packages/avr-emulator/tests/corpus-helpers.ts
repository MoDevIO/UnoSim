/// <reference lib="es2022.regexp" />
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BoardHardwareId,
  type HeadlessResult,
  type StateExpectation,
  type StimulusEvent,
  buildSimulationImage,
  isBoardHardwareId,
  loadSimulationImage,
  parseStimuli,
  runHeadless,
} from "../src/index";

/** The reference corpus of plan 7.4. */
export const CORPUS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/runtime-corpus");

export const PROVENANCES = ["hardware", "derived", "regression"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export interface Tolerance {
  /** Regular expression whose capture groups hold the numbers that may deviate; matched against whole lines. */
  readonly pattern: string;
  readonly plusMinus: number;
  /** Why the value may deviate (plan 7.4: tolerances only for time values, justified per case). */
  readonly reason: string;
}

export interface CorpusCase {
  readonly id: string;
  readonly group: string;
  readonly dir: string;
  readonly board: BoardHardwareId;
  readonly simMs: number;
  readonly provenance: Provenance;
  /** How the expectation was obtained (required for `derived`: the independent source). */
  readonly basis: string;
  readonly recordedOn?: string;
  readonly toolchain: string;
  readonly description: string;
  readonly events: readonly StimulusEvent[];
  readonly expectState: readonly StateExpectation[];
  readonly tolerances: readonly Tolerance[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates a parsed `case.json`; throws an Error naming the problem. */
export function parseCaseFile(raw: unknown, id: string, group: string, dir: string): CorpusCase {
  if (!isObject(raw)) throw new Error(`${id}: case.json must be an object`);
  const text = (key: string, required = true): string => {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (required) throw new Error(`${id}: "${key}" must be a non-empty string`);
    return "";
  };
  const board = text("board");
  if (!isBoardHardwareId(board)) throw new Error(`${id}: unknown board "${board}"`);
  const provenance = text("provenance");
  if (!(PROVENANCES as readonly string[]).includes(provenance)) throw new Error(`${id}: provenance must be one of ${PROVENANCES.join(", ")}`);
  const { simMs } = raw;
  if (typeof simMs !== "number" || !Number.isFinite(simMs) || simMs <= 0) throw new Error(`${id}: simMs must be a positive number`);
  if (provenance === "hardware" && !raw.recordedOn) throw new Error(`${id}: a hardware case needs "recordedOn"`);
  const events = raw.events ?? [];
  const expectState = raw.expectState ?? [];
  parseStimuli(events, "events");
  parseStimuli(expectState, "expectState");
  const tolerances = (raw.tolerances ?? []) as unknown[];
  if (!Array.isArray(tolerances)) throw new Error(`${id}: tolerances must be an array`);
  for (const entry of tolerances) {
    if (!isObject(entry) || typeof entry.pattern !== "string" || typeof entry.plusMinus !== "number" || typeof entry.reason !== "string") {
      throw new Error(`${id}: each tolerance needs pattern, plusMinus and reason`);
    }
    new RegExp(entry.pattern);
  }
  return {
    id, group, dir, board, simMs, provenance: provenance as Provenance,
    basis: text("basis"),
    ...(typeof raw.recordedOn === "string" ? { recordedOn: raw.recordedOn } : {}),
    toolchain: text("toolchain"),
    description: text("description"),
    events: events as StimulusEvent[],
    expectState: expectState as StateExpectation[],
    tolerances: tolerances as Tolerance[],
  };
}

/** All cases of the corpus, sorted by group and id. */
export function loadCorpus(root = CORPUS_ROOT): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (const group of readdirSync(root, { withFileTypes: true })) {
    if (!group.isDirectory() || group.name === "hex") continue;
    for (const entry of readdirSync(join(root, group.name), { withFileTypes: true })) {
      const dir = join(root, group.name, entry.name);
      if (entry.isDirectory() && existsSync(join(dir, "case.json"))) {
        cases.push(parseCaseFile(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")), entry.name, group.name, dir));
      }
    }
  }
  return cases.sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
}

export const hexOf = (testCase: CorpusCase, root = CORPUS_ROOT): string => readFileSync(join(root, "hex", testCase.board, `${testCase.id}.hex`), "utf8");
export const expectedOf = (testCase: CorpusCase): string => readFileSync(join(testCase.dir, `expected.${testCase.board}.txt`), "utf8");

/** Line ending and trailing-newline normalisation used for expectations: CRLF → LF. */
export const normalizeOutput = (text: string): string => text.replaceAll("\r\n", "\n");

/**
 * Compares output with the expectation line by line. A line the tolerance
 * pattern matches may differ in every captured number by at most `plusMinus`;
 * everything else must be equal. Returns the differences (empty = equal).
 */
export function diffOutput(expected: string, actual: string, tolerances: readonly Tolerance[] = []): string[] {
  const want = expected.split("\n");
  const got = actual.split("\n");
  const problems: string[] = [];
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (!lineMatches(want[i], got[i], tolerances)) problems.push(`line ${i + 1}: expected ${JSON.stringify(want[i])}, got ${JSON.stringify(got[i])}`);
  }
  return problems;
}

/** Line with the spans of all capture groups cut out, and the numbers in them. */
function split(line: string, regex: RegExp): { rest: string; numbers: number[] } | undefined {
  const match = regex.exec(line);
  if (!match?.indices) return undefined;
  const spans = match.indices.slice(1).filter((span): span is [number, number] => span !== undefined);
  if (spans.length === 0) return undefined;
  let rest = "";
  let from = 0;
  for (const [start, end] of spans) {
    rest += line.slice(from, start);
    from = end;
  }
  return { rest: rest + line.slice(from), numbers: spans.map(([start, end]) => Number(line.slice(start, end))) };
}

function lineMatches(want: string | undefined, got: string | undefined, tolerances: readonly Tolerance[]): boolean {
  if (want === got) return true;
  if (want === undefined || got === undefined) return false;
  return tolerances.some(({ pattern, plusMinus }) => {
    const regex = new RegExp(pattern, "d");
    const a = split(want, regex);
    const b = split(got, regex);
    return a !== undefined && b !== undefined && a.rest === b.rest && a.numbers.every((n, i) => Math.abs(n - b.numbers[i]) <= plusMinus);
  });
}

export interface CaseRun {
  readonly result: HeadlessResult;
  /** Serial port 0, normalised. */
  readonly output: string;
}

/** Runs a case headless from its checked-in HEX. */
export function runCase(testCase: CorpusCase, hex = hexOf(testCase)): CaseRun {
  const image = loadSimulationImage(buildSimulationImage({ board: testCase.board, hex }));
  const result = runHeadless(image, { simMs: testCase.simMs, events: testCase.events, expectState: testCase.expectState });
  return { result, output: normalizeOutput(result.serial.get(0) ?? "") };
}

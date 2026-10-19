import type { IOFunction, IOOrigin, IOPinRecord } from "@shared/schema";

const FUNCTIONS: readonly IOFunction[] = ["pinMode", "digitalRead", "digitalWrite", "analogRead", "analogWrite"];
const PIN_MODES = ["INPUT", "OUTPUT", "INPUT_PULLUP"] as const;
type LineMark = number | "runtime";

type LineKey = `${IOFunction}Lines`;
type LocationKey = `${IOFunction}Locations`;

/** "13", "A0" and "14" name the same pin on the Uno and Nano (plan 4.9 merges per pin). */
function pinKey(pin: string): string {
  const analog = /^A(\d+)$/i.exec(pin);
  return analog ? String(14 + Number(analog[1])) : pin;
}

interface RuntimeFinding {
  readonly lines: LineMark[];
  readonly modes: string[];
}

/** What a runtime record says per function: lines (0 means "no line", shown as "runtime") and, for pinMode, the modes. */
function runtimeFindings(record: IOPinRecord): Map<IOFunction, RuntimeFinding> {
  const found = new Map<IOFunction, RuntimeFinding>();
  const add = (fn: IOFunction, line: number, mode?: string): void => {
    let finding = found.get(fn);
    if (!finding) {
      finding = { lines: [], modes: [] };
      found.set(fn, finding);
    }
    const mark: LineMark = line > 0 ? line : "runtime";
    if (!finding.lines.includes(mark)) finding.lines.push(mark);
    if (mode !== undefined && !finding.modes.includes(mode)) finding.modes.push(mode);
  };
  for (const { line, operation } of record.usedAt ?? []) {
    const fn = FUNCTIONS.find((candidate) => operation === candidate || operation.startsWith(`${candidate}:`));
    if (!fn) continue;
    add(fn, line, fn === "pinMode" ? PIN_MODES[Number(/pinMode:(\d+)/.exec(operation)?.[1])] : undefined);
  }
  if (record.pinMode !== undefined && PIN_MODES[record.pinMode] && !found.has("pinMode")) {
    add("pinMode", record.definedAt?.line ?? 0, PIN_MODES[record.pinMode]);
  }
  return found;
}

const hasStatic = (record: IOPinRecord, fn: IOFunction): boolean =>
  ((record[`${fn}Lines` as LineKey]?.length ?? 0) > 0) || ((record[`${fn}Locations` as LocationKey]?.length ?? 0) > 0);

function mergePin(staticRecord: IOPinRecord | undefined, runtimeRecord: IOPinRecord | undefined): IOPinRecord {
  if (!runtimeRecord) return staticRecord as IOPinRecord;
  const findings = runtimeFindings(runtimeRecord);
  const base: IOPinRecord = staticRecord ? { ...staticRecord } : { pin: runtimeRecord.pin, defined: runtimeRecord.defined };
  const origin: Partial<Record<IOFunction, IOOrigin>> = {};
  const target = base as unknown as Record<string, unknown>;

  for (const fn of FUNCTIONS) {
    const fromStatic = staticRecord !== undefined && hasStatic(staticRecord, fn);
    const finding = findings.get(fn);
    if (!fromStatic && !finding) continue;
    origin[fn] = fromStatic && finding ? "both" : fromStatic ? "static" : "runtime";
    if (!fromStatic && finding) {
      target[`${fn}Lines`] = [...((staticRecord?.[`${fn}Lines` as LineKey] as LineMark[] | undefined) ?? []), ...finding.lines];
    }
  }

  const runtimeModes = findings.get("pinMode")?.modes ?? [];
  const staticModes = staticRecord?.pinModeModes ?? [];
  if (origin.pinMode === "runtime") {
    base.pinModeModes = [...staticModes, ...runtimeModes] as NonNullable<IOPinRecord["pinModeModes"]>;
  } else if (origin.pinMode === "both" && runtimeModes.some((mode) => !staticModes.includes(mode as never))) {
    base.conflict = true;
    const note = `Static analysis found ${[...new Set(staticModes)].join("/")}, the running simulation used ${runtimeModes.join("/")}`;
    base.conflictMessage = base.conflictMessage ? `${base.conflictMessage}; ${note}` : note;
  }

  base.defined = base.defined || runtimeRecord.defined;
  base.origin = origin;
  return base;
}

/**
 * Merges the static analysis with the findings of a running simulation, for
 * both backends (plan 4.9, P3.7): every static entry and its lines stay;
 * runtime findings add per pin and function and carry their origin; a pin only
 * the run saw is added as a runtime entry; a pin mode that contradicts the
 * static analysis marks the pin as a conflict.
 */
export function mergeIoRegistry(staticRegistry: readonly IOPinRecord[], runtimeRegistry: readonly IOPinRecord[]): IOPinRecord[] {
  const runtimeByPin = new Map(runtimeRegistry.map((record) => [pinKey(record.pin), record]));
  const merged = staticRegistry.map((record) => mergePin(record, runtimeByPin.get(pinKey(record.pin))));
  const known = new Set(staticRegistry.map((record) => pinKey(record.pin)));
  for (const record of runtimeRegistry) {
    if (!known.has(pinKey(record.pin))) merged.push(mergePin(undefined, record));
  }
  return merged;
}

import type { DiagnosticEvent, StopReason } from "../runtime/emulator";
import type { IoUsage } from "../io/io-usage";
import type { PinChanges, PinSnapshot } from "../io/pin-model";
import type { SerialOutput } from "../io/serial-ports";
import type { RunEvent, RunStatus, WorkerEvent } from "./messages";

export interface BatcherOptions {
  /** Wall clock in milliseconds. */
  readonly now: () => number;
  /** At most one packet group per interval (plan 4.5: about 60 packets per second). */
  readonly minIntervalMs?: number;
  readonly telemetryIntervalMs?: number;
  /** Serial text beyond this many pending characters is dropped and counted (UI protection). */
  readonly maxPendingSerialChars?: number;
  /** Longest serial text in one event; longer text is split. */
  readonly maxSerialChunkChars?: number;
  /** Pending usage, diagnostic and status entries above this count are dropped. */
  readonly maxPendingEntries?: number;
}

export interface FlushContext {
  readonly runId: number;
  readonly simTimeMs: number;
  readonly realTimeFactor: number;
}

type Entry =
  | { readonly kind: "serial"; port: number; text: string }
  | { readonly kind: "event"; readonly event: WorkerEvent };

/**
 * Bundles the worker's output for the UI (plan 4.5, P1.11): pins are merged
 * to the last state per pin, serial text per port to coherent text, usage
 * findings to one list, telemetry is created once per second. `flush()`
 * returns at most one group per `minIntervalMs`; everything else waits, so
 * the UI receives about 60 packets per second at most. Memory and packet
 * size are bounded: serial text above `maxPendingSerialChars` is dropped and
 * counted, pending entries above `maxPendingEntries` as well. Order of
 * serial text, diagnostics and status changes is kept; the merged pin
 * states come after them in the same group.
 */
export class EventBatcher {
  private readonly minIntervalMs: number;
  private readonly telemetryIntervalMs: number;
  private readonly maxPendingSerialChars: number;
  private readonly maxSerialChunkChars: number;
  private readonly maxPendingEntries: number;
  private entries: Entry[] = [];
  private pendingSerialChars = 0;
  private pins = new Map<number, PinSnapshot>();
  private pinChangeCount = 0;
  private usages: IoUsage[] = [];
  private lastFlush: number | undefined;
  private lastTelemetry: number;
  private telemetryPinChanges = 0;
  private telemetrySerialChars = 0;
  private telemetryDroppedChars = 0;

  constructor(private readonly options: BatcherOptions) {
    this.minIntervalMs = options.minIntervalMs ?? 1000 / 60;
    this.telemetryIntervalMs = options.telemetryIntervalMs ?? 1000;
    this.maxPendingSerialChars = options.maxPendingSerialChars ?? 256 * 1024;
    this.maxSerialChunkChars = options.maxSerialChunkChars ?? 32 * 1024;
    this.maxPendingEntries = options.maxPendingEntries ?? 1000;
    this.lastTelemetry = options.now();
  }

  addPins({ changes, changeCount }: PinChanges): void {
    for (const state of changes) this.pins.set(state.pin, state);
    this.pinChangeCount += changeCount;
    this.telemetryPinChanges += changeCount;
  }

  addSerial(output: readonly SerialOutput[]): void {
    for (const { port, text } of output) {
      const room = this.maxPendingSerialChars - this.pendingSerialChars;
      const kept = text.length <= room ? text : text.slice(0, Math.max(0, room));
      this.telemetryDroppedChars += text.length - kept.length;
      if (kept.length === 0) continue;
      this.pendingSerialChars += kept.length;
      this.telemetrySerialChars += kept.length;
      const last = this.entries.at(-1);
      if (last?.kind === "serial" && last.port === port) last.text += kept;
      else this.entries.push({ kind: "serial", port, text: kept });
    }
  }

  addUsages(usages: readonly IoUsage[]): void {
    this.usages.push(...usages);
  }

  addDiagnostics(diagnostics: readonly DiagnosticEvent[]): void {
    for (const diagnostic of diagnostics) this.addEvent({ type: "diagnostic", diagnostic });
  }

  addStatus(state: RunStatus, extra: { reason?: StopReason; simTimeMs?: number; wallTimeMs?: number } = {}): void {
    this.addEvent({ type: "status", state, ...extra });
  }

  addFault(message: string): void {
    this.addEvent({ type: "fault", message });
  }

  /** True when `flush()` would return events now (not counting telemetry). */
  get ready(): boolean {
    return this.hasPending() && this.intervalPassed(this.options.now());
  }

  /** Events for the UI, or an empty list while the interval has not passed or nothing is pending. */
  flush(context: FlushContext): RunEvent[] {
    const now = this.options.now();
    const telemetryDue = now - this.lastTelemetry >= this.telemetryIntervalMs;
    if (!this.intervalPassed(now) || !(this.hasPending() || telemetryDue)) return [];
    this.lastFlush = now;
    const events: WorkerEvent[] = [];
    for (const entry of this.entries) {
      if (entry.kind === "event") events.push(entry.event);
      else for (let i = 0; i < entry.text.length; i += this.maxSerialChunkChars) {
        events.push({ type: "serial", port: entry.port, text: entry.text.slice(i, i + this.maxSerialChunkChars) });
      }
    }
    if (this.usages.length > 0) events.push({ type: "usage", usages: this.usages });
    if (this.pins.size > 0) {
      events.push({ type: "pins", changes: [...this.pins.values()].sort((a, b) => a.pin - b.pin), changeCount: this.pinChangeCount });
    }
    if (telemetryDue) events.push(this.telemetry(now, context));
    this.reset();
    return events.map((event) => ({ ...event, runId: context.runId }));
  }

  /** Drops everything pending, e.g. when the run ends. */
  discard(): void {
    this.reset();
  }

  private telemetry(now: number, { simTimeMs, realTimeFactor }: FlushContext): WorkerEvent {
    const seconds = Math.max(1e-3, (now - this.lastTelemetry) / 1000);
    const event: WorkerEvent = {
      type: "telemetry",
      simTimeMs,
      realTimeFactor,
      pinChangesPerSecond: this.telemetryPinChanges / seconds,
      serialCharsPerSecond: this.telemetrySerialChars / seconds,
      serialCharsDropped: this.telemetryDroppedChars,
    };
    this.lastTelemetry = now;
    this.telemetryPinChanges = 0;
    this.telemetrySerialChars = 0;
    this.telemetryDroppedChars = 0;
    return event;
  }

  private addEvent(event: WorkerEvent): void {
    if (this.entries.length >= this.maxPendingEntries) return;
    this.entries.push({ kind: "event", event });
  }

  private intervalPassed(now: number): boolean {
    return this.lastFlush === undefined || now - this.lastFlush >= this.minIntervalMs;
  }

  private hasPending(): boolean {
    return this.entries.length > 0 || this.usages.length > 0 || this.pins.size > 0;
  }

  private reset(): void {
    this.entries = [];
    this.pendingSerialChars = 0;
    this.pins = new Map();
    this.pinChangeCount = 0;
    this.usages = [];
  }
}

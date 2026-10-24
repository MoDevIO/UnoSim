import { decodeBase64 } from "@unosim/avr-emulator/image";
import { RunGate, type Command, type IoUsage, type PinSnapshot, type RunEvent, type RunStatus, type StopReason, type TelemetrySample } from "@unosim/avr-emulator/protocol";
import { boardPinLabel } from "@shared/board-pins";
import type { BoardId } from "@shared/boards";
import type { IOPinRecord } from "@shared/schema";
import { diagnosticLine } from "./diagnostic-lines";
import type { AnyRuntimeEvent, RuntimeFeatures, SimulationRuntime, StartRequest } from "./simulation-runtime";

/** The part of a `Worker` the runtime uses (a fake in tests). */
export interface EmulatorWorker {
  postMessage(message: Command, transfer?: ArrayBuffer[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: { readonly message?: string }) => void): void;
}

/** Clock and timers of the supervision; tests drive them by hand. */
export interface RuntimeTimers {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Deadlines of the supervision (plan 4.5): the worker cannot watch itself,
 * so the main thread ends a worker that does not answer in time. They apply
 * in the visible tab: browsers throttle or freeze hidden tabs, so a deadline
 * that runs out there starts again, and silence counts from the return.
 */
export interface SupervisionLimits {
  /** `load` until `ready`: includes fetching and starting the worker module. */
  readonly readyMs: number;
  /** A command that changes the state (start, pause, resume, reset) until its `status` confirmation. */
  readonly confirmMs: number;
  /** `stop` until `status stopped`; afterwards the worker is terminated. */
  readonly stopMs: number;
  /** Longest silence while a machine is loaded; the worker sends a heartbeat about every 500 ms, also in the pause. */
  readonly heartbeatMs: number;
}

export const DEFAULT_SUPERVISION: SupervisionLimits = { readyMs: 15_000, confirmMs: 5_000, stopMs: 2_000, heartbeatMs: 3_000 };

export const BROWSER_FEATURES: RuntimeFeatures = {
  serialInput: true,
  pause: true,
  resetWithoutCompile: true,
  survivesConnectionLoss: true,
};

export interface BrowserRuntimeOptions {
  createWorker(): EmulatorWorker;
  timers?: RuntimeTimers;
  limits?: Partial<SupervisionLimits>;
  /** Whether the tab is hidden; by default `document.visibilityState`. */
  isHidden?: () => boolean;
}

const documentHidden = (): boolean => globalThis.document?.visibilityState === "hidden";

const systemTimers: RuntimeTimers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** System lines as the server sends them today (SimulationRuntime SSOT, UI texts). */
export const SYSTEM_LINES = {
  paused: "--- Simulation paused ---\n",
  resumed: "--- Simulation resumed ---\n",
  stopped: "--- Simulation stopped ---\n",
} as const;

const timeoutLine = (seconds: number): string => `--- Simulation timeout (${seconds}s) ---\n`;
const MODE_NUMBER = { INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2 } as const;
/** Largest chunk of serial input sent in one command (the worker accepts 4096 bytes of UTF-8, up to 4 per character). */
const SERIAL_CHUNK_CHARS = 1024;

type Phase = "idle" | "loading" | "starting" | "active";

/**
 * The browser emulation behind the `SimulationRuntime` interface (plan P3.2).
 * It owns one worker, created on the first start and kept between runs, and
 * translates in both directions: commands with a `runId` to the worker,
 * worker events into the events of the existing WebSocket handler, including
 * the system lines the server sends today. It supervises the worker:
 * events of other runs are dropped (`RunGate`), a state counts only once the
 * worker confirmed it, `error` and `messageerror` end the run, and a worker
 * that misses a deadline or its heartbeat is terminated.
 */
export class BrowserRuntime implements SimulationRuntime {
  readonly kind = "browser" as const;
  readonly features = BROWSER_FEATURES;
  private readonly listeners = new Set<(event: AnyRuntimeEvent) => void>();
  private readonly timers: RuntimeTimers;
  private readonly limits: SupervisionLimits;
  private readonly isHidden: () => boolean;
  private readonly gate = new RunGate();
  private worker: EmulatorWorker | undefined;
  private phase: Phase = "idle";
  private pendingStart: { readonly timeoutSec: number; readonly serialBaud?: number } | undefined;
  private timeoutSec = 0;
  private deadline: unknown;
  private heartbeatTimer: unknown;
  private lastHeard = 0;
  private stoppingRunId: number | undefined;
  private lastStatus: RunStatus | undefined;
  /** The board of the current run: pin names in the registry follow it (A6/A7 of the Nano). */
  private board: BoardId = "uno";
  /** Ports whose last chunk ended in a CR that waits for a possible LF. */
  private readonly heldCarriageReturn = new Set<number>();
  private readonly lastPins = new Map<number, string>();
  /** Runtime findings of the run as records of the I/O registry, by pin. */
  private readonly registry = new Map<number, IOPinRecord>();

  constructor(private readonly options: BrowserRuntimeOptions) {
    this.timers = options.timers ?? systemTimers;
    this.limits = { ...DEFAULT_SUPERVISION, ...options.limits };
    this.isHidden = options.isHidden ?? documentHidden;
  }

  start(request: StartRequest): void {
    if (request.kind !== "browser") throw new TypeError(`the browser runtime cannot start a ${request.kind} request`);
    if (this.phase !== "idle") this.endRun();
    const { artifact } = request;
    const flash = decodeBase64(artifact.flashBase64);
    const buffer = flash.buffer.slice(flash.byteOffset, flash.byteOffset + flash.byteLength) as ArrayBuffer;
    this.lastPins.clear();
    this.registry.clear();
    this.board = artifact.board;
    this.heldCarriageReturn.clear();
    this.pendingStart = { timeoutSec: request.timeoutSec, ...(request.serialBaud === undefined ? {} : { serialBaud: request.serialBaud }) };
    this.timeoutSec = request.timeoutSec;
    this.phase = "loading";
    this.lastHeard = this.timers.now();
    this.armHeartbeat();
    this.post(
      { type: "load", runId: this.gate.runIdFor("load"), board: request.board ?? artifact.board, artifactBoard: artifact.board, buildId: artifact.buildId, sha256: artifact.sha256, flash: buffer, symbols: artifact.symbols },
      [buffer],
    );
    this.expect(this.limits.readyMs, "the emulator did not become ready");
  }

  pause(): void {
    if (this.gate.state !== "running") return;
    this.command("pause");
  }

  resume(): void {
    if (this.gate.state !== "paused") return;
    this.command("resume");
  }

  stop(): void {
    if (this.phase === "idle") return;
    const runId = this.gate.runId;
    const hadMachine = this.phase === "active" || this.phase === "starting";
    this.clearDeadline();
    if (runId !== undefined && this.worker && this.phase !== "loading") {
      this.stoppingRunId = runId;
      this.post({ type: "stop", runId });
      this.deadline = this.timers.setTimeout(() => this.terminateWorker(), this.limits.stopMs);
    } else {
      this.terminateWorker(); // still loading: nothing to ask, and the worker may be stuck
    }
    this.finish(hadMachine ? [{ type: "serial_output", data: SYSTEM_LINES.stopped, isComplete: true }] : []);
  }

  /** CPU reset without compiling again. */
  reset(): void {
    if (this.gate.state !== "running" && this.gate.state !== "paused") return;
    this.lastPins.clear();
    this.registry.clear(); // the new machine reports its first uses again
    this.command("reset");
  }

  sendSerial(text: string, port = 0): void {
    if (this.gate.state !== "running") return;
    const runId = this.gate.runId;
    if (runId === undefined) return;
    for (let at = 0; at < text.length; at += SERIAL_CHUNK_CHARS) {
      this.post({ type: "serialIn", runId, port, text: text.slice(at, at + SERIAL_CHUNK_CHARS) });
    }
  }

  setPin(pin: number, value: number): void {
    const runId = this.activeRunId();
    if (runId !== undefined) this.post({ type: "setDigital", runId, pin, level: value === 0 ? 0 : 1 });
  }

  setAnalog(pin: number, value: number): void {
    const runId = this.activeRunId();
    if (runId !== undefined) this.post({ type: "setAnalog", runId, pin, value });
  }

  subscribe(listener: (event: AnyRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.clearDeadline();
    this.clearHeartbeat();
    this.terminateWorker();
    this.listeners.clear();
    this.phase = "idle";
  }

  // --- worker events -------------------------------------------------------

  private ensureWorker(): EmulatorWorker {
    if (this.worker) return this.worker;
    const worker = this.options.createWorker();
    worker.addEventListener("message", (event) => {
      if (this.worker === worker) this.receive(event.data);
    });
    worker.addEventListener("error", (event) => {
      const detail = event.message ? `: ${event.message}` : "";
      if (this.worker === worker) this.fail(`the emulator worker failed${detail}`);
    });
    worker.addEventListener("messageerror", () => {
      if (this.worker === worker) this.fail("the emulator worker sent a message that could not be read");
    });
    this.worker = worker;
    return worker;
  }

  private receive(data: unknown): void {
    if (!isRunEvent(data)) return;
    if (data.runId === this.stoppingRunId && data.type === "status" && data.state === "stopped") {
      this.stoppingRunId = undefined;
      this.clearDeadline();
      return;
    }
    if (!this.gate.accept(data)) return;
    this.lastHeard = this.timers.now();
    switch (data.type) {
      case "ready":
        this.onReady();
        break;
      case "heartbeat":
        break;
      case "status":
        this.onStatus(data.state, data.reason);
        break;
      case "serial":
        this.emitSerial(data.text, data.port);
        break;
      case "pins":
        this.emitPins(data.changes);
        break;
      case "usage":
        this.emit({ type: "runtime_usage", usages: data.usages });
        this.emit(this.registryWith(data.usages));
        break;
      case "telemetry":
        this.emit({ type: "runtime_telemetry", sample: telemetrySample(data) });
        break;
      case "diagnostic":
        this.emit({ type: "serial_output", data: diagnosticLine(data.diagnostic), isComplete: true });
        this.emit({ type: "runtime_diagnostic", diagnostic: data.diagnostic });
        break;
      case "fault":
        this.emit({ type: "operation_error", operation: "start_simulation", code: "RUNTIME_FAILED", message: data.message });
        break;
    }
  }

  private onReady(): void {
    const start = this.pendingStart;
    if (this.phase !== "loading" || !start) return;
    this.pendingStart = undefined;
    this.phase = "starting";
    this.post({
      type: "start",
      runId: this.gate.runIdFor("start"),
      timeoutMs: start.timeoutSec * 1000,
      ...(start.serialBaud === undefined ? {} : { serialBaud: start.serialBaud }),
    });
    this.expect(this.limits.confirmMs, "the emulator did not start");
  }

  private onStatus(state: RunStatus, reason: StopReason | undefined): void {
    this.clearDeadline();
    if (state === "stopped") {
      const lines = reason === "timeout" ? [timeoutLine(this.timeoutSec)] : [];
      this.finish(lines.map((data) => ({ type: "serial_output" as const, data, isComplete: true })));
      return;
    }
    const wasPaused = this.phase === "active" && this.lastStatus === "paused";
    this.phase = "active";
    this.lastStatus = state;
    this.emit({ type: "simulation_status", status: state });
    if (state === "paused") this.emit({ type: "serial_output", data: SYSTEM_LINES.paused, isComplete: true });
    else if (wasPaused) this.emit({ type: "serial_output", data: SYSTEM_LINES.resumed, isComplete: true });
  }

  /**
   * Serial text in the form of the server's messages: lines end with "\n" (CRLF becomes LF), `isComplete` says
   * whether the text ends a line. A CR at the end of a chunk waits for the LF that may follow in the next one.
   */
  private emitSerial(chunk: string, port: number): void {
    let text = this.heldCarriageReturn.has(port) ? `\r${chunk}` : chunk;
    if (text.endsWith("\r")) {
      this.heldCarriageReturn.add(port);
      text = text.slice(0, -1);
    } else {
      this.heldCarriageReturn.delete(port);
    }
    text = text.replaceAll("\r\n", "\n");
    if (text.length === 0) return;
    this.emit({ type: "serial_output", data: text, isComplete: text.endsWith("\n"), ...(port === 0 ? {} : { port }) });
  }

  /** The findings so far as the `io_registry` snapshot the existing handler evaluates; the lines stay 0, only the static analysis knows lines. */
  private registryWith(usages: readonly IoUsage[]): Extract<AnyRuntimeEvent, { type: "io_registry" }> {
    for (const { pin, fn, mode } of usages) {
      const record = this.registry.get(pin) ?? { pin: boardPinLabel(this.board, pin), defined: false, usedAt: [] };
      const modeNumber = mode === undefined ? undefined : MODE_NUMBER[mode];
      if (fn === "pinMode" && modeNumber !== undefined) {
        record.defined = true;
        record.pinMode = modeNumber;
      }
      record.usedAt = [...(record.usedAt ?? []), { line: 0, operation: fn === "pinMode" && modeNumber !== undefined ? `pinMode:${modeNumber}` : fn }];
      this.registry.set(pin, record);
    }
    return { type: "io_registry", registry: [...this.registry.values()].map((record) => ({ ...record })) };
  }

  private emitPins(changes: readonly PinSnapshot[]): void {
    const states: Array<{ pin: number; stateType: "mode" | "value" | "pwm"; value: number }> = [];
    for (const change of changes) {
      const key = `${change.mode}:${change.level}:${change.pwm ?? ""}`;
      if (this.lastPins.get(change.pin) === key) continue;
      this.lastPins.set(change.pin, key);
      states.push(
        { pin: change.pin, stateType: "mode", value: MODE_NUMBER[change.mode] },
        { pin: change.pin, stateType: "value", value: change.level },
        ...(change.pwm === undefined ? [] : [{ pin: change.pin, stateType: "pwm" as const, value: change.pwm }]),
      );
    }
    if (states.length > 0) this.emit({ type: "pin_state_batch", states, timestamp: this.timers.now() });
  }

  // --- supervision ---------------------------------------------------------

  private command(type: "pause" | "resume" | "reset"): void {
    this.post({ type, runId: this.gate.runIdFor(type) });
    this.expect(this.limits.confirmMs, `the emulator did not confirm ${type}`);
  }

  private expect(ms: number, message: string): void {
    this.clearDeadline();
    this.deadline = this.timers.setTimeout(() => (this.isHidden() ? this.expect(ms, message) : this.fail(message)), ms);
  }

  private armHeartbeat(): void {
    this.clearHeartbeat();
    const check = (): void => {
      if (this.phase === "idle") return;
      if (this.isHidden()) this.lastHeard = this.timers.now();
      // While loading, the `ready` deadline governs: the worker module may take longer to arrive than a heartbeat period.
      if (this.phase !== "loading" && this.timers.now() - this.lastHeard >= this.limits.heartbeatMs) this.fail("the emulator stopped responding");
      else this.heartbeatTimer = this.timers.setTimeout(check, this.limits.heartbeatMs / 2);
    };
    this.heartbeatTimer = this.timers.setTimeout(check, this.limits.heartbeatMs / 2);
  }

  /** The worker is broken or silent: end the run, terminate the worker (the next start creates a new one) and report. */
  private fail(message: string): void {
    const hadRun = this.phase !== "idle";
    this.terminateWorker();
    if (!hadRun) return;
    this.finish([
      { type: "operation_error", operation: "start_simulation", code: "RUNTIME_FAILED", message },
      { type: "serial_output", data: `[ERR] ${message}\n`, isComplete: true },
    ]);
  }

  private endRun(): void {
    const runId = this.gate.runId;
    if (runId !== undefined && this.worker && this.phase !== "loading") this.post({ type: "stop", runId });
    this.finish([]);
  }

  /** The run is over for the UI: state `stopped`, supervision off, later events of the run dropped. */
  private finish(before: readonly AnyRuntimeEvent[]): void {
    this.clearDeadline(this.stoppingRunId === undefined);
    this.clearHeartbeat();
    this.phase = "idle";
    this.pendingStart = undefined;
    this.lastStatus = undefined;
    this.gate.end();
    for (const event of before) this.emit(event);
    this.emit({ type: "simulation_status", status: "stopped" });
  }

  private terminateWorker(): void {
    const { worker } = this;
    this.worker = undefined;
    this.stoppingRunId = undefined;
    this.clearDeadline();
    worker?.terminate();
  }

  private clearDeadline(clear = true): void {
    if (!clear || this.deadline === undefined) return;
    this.timers.clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    this.timers.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private activeRunId(): number | undefined {
    return this.gate.state === "running" || this.gate.state === "paused" ? this.gate.runId : undefined;
  }

  private post(command: Command, transfer?: ArrayBuffer[]): void {
    this.ensureWorker().postMessage(command, transfer);
  }

  private emit(event: AnyRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function telemetrySample(event: Extract<RunEvent, { type: "telemetry" }>): TelemetrySample {
  const { simTimeMs, realTimeFactor, pinChangesPerSecond, serialCharsPerSecond, serialCharsDropped } = event;
  return { simTimeMs, realTimeFactor, pinChangesPerSecond, serialCharsPerSecond, serialCharsDropped };
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== "object" || value === null) return false;
  const { type, runId } = value as { type?: unknown; runId?: unknown };
  return typeof type === "string" && typeof runId === "number";
}

/** The browser runtime on a module worker; the emulator loads only inside the worker chunk (plan P3.9). */
export function createBrowserRuntime(): BrowserRuntime {
  return new BrowserRuntime({
    createWorker: () => new Worker(new URL("./emulator.worker.ts", import.meta.url), { type: "module" }) as unknown as EmulatorWorker,
  });
}

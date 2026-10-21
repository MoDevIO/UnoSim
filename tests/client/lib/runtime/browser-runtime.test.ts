import { describe, expect, it } from "vitest";
import type { SimulationArtifact } from "@shared/simulation-artifact";
import type { Command, RunEvent } from "@unosim/avr-emulator/protocol";
import {
  BROWSER_FEATURES, BrowserRuntime, DEFAULT_SUPERVISION, type EmulatorWorker, type RuntimeTimers, SYSTEM_LINES,
} from "../../../../client/src/lib/runtime/browser-runtime";
import type { AnyRuntimeEvent } from "../../../../client/src/lib/runtime/simulation-runtime";

class FakeWorker implements EmulatorWorker {
  readonly sent: Command[] = [];
  readonly transfers: ArrayBuffer[][] = [];
  terminated = false;
  private message: (event: { data: unknown }) => void = () => undefined;
  private error: (event: { message?: string }) => void = () => undefined;
  private messageError: (event: { message?: string }) => void = () => undefined;

  postMessage(command: Command, transfer: ArrayBuffer[] = []): void {
    this.sent.push(command);
    this.transfers.push(transfer);
  }
  terminate(): void { this.terminated = true; }
  addEventListener(type: "message" | "error" | "messageerror", listener: never): void {
    if (type === "message") this.message = listener;
    else if (type === "error") this.error = listener;
    else this.messageError = listener;
  }
  emit(event: unknown): void { this.message({ data: event }); }
  fail(message?: string): void { this.error(message === undefined ? {} : { message }); }
  failMessage(): void { this.messageError({}); }
  last<T extends Command["type"]>(type: T): Extract<Command, { type: T }> {
    const found = [...this.sent].reverse().find((command) => command.type === type);
    if (!found) throw new Error(`no ${type} command sent`);
    return found as Extract<Command, { type: T }>;
  }
}

class FakeTimers implements RuntimeTimers {
  time = 0;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();
  now(): number { return this.time; }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void { this.pending.delete(handle as number); }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = end;
  }
}

const artifact = {
  formatVersion: 1, board: "uno", flashBase64: "AQIDBA==", flashBytes: 4, sha256: "a".repeat(64), buildId: "b".repeat(64),
  symbols: { functions: {}, data: {} },
} as unknown as SimulationArtifact;

function setup() {
  const workers: FakeWorker[] = [];
  const timers = new FakeTimers();
  const runtime = new BrowserRuntime({ createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; }, timers });
  const events: AnyRuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  const ev = <T extends RunEvent["type"]>(runId: number, event: Omit<Extract<RunEvent, { type: T }>, "runId">) => ({ ...event, runId });
  const worker = () => workers.at(-1) as FakeWorker;
  /** Starts a run and brings it to `running` the way the worker does. */
  const startRunning = (timeoutSec = 30) => {
    runtime.start({ kind: "browser", artifact, timeoutSec });
    const load = worker().last("load");
    worker().emit(ev(load.runId, { type: "ready", protocolVersion: 1, board: "uno", buildId: artifact.buildId }));
    const start = worker().last("start");
    worker().emit(ev(start.runId, { type: "status", state: "running" }));
    return start.runId;
  };
  const statuses = () => events.filter((event) => event.type === "simulation_status").map((event) => (event as { status: string }).status);
  const lines = () => events.filter((event) => event.type === "serial_output").map((event) => (event as { data: string }).data);
  return { runtime, workers, worker, timers, events, ev, startRunning, statuses, lines };
}

describe("BrowserRuntime (plan P3.2)", () => {
  it("describes itself as the browser emulation", () => {
    const { runtime } = setup();

    expect(runtime.kind).toBe("browser");
    expect(runtime.features).toEqual(BROWSER_FEATURES);
    expect(runtime.features).toMatchObject({ resetWithoutCompile: true, survivesConnectionLoss: true });
  });

  it("refuses a request meant for the host mock", () => {
    const { runtime, workers } = setup();

    expect(() => runtime.start({ kind: "host-mock", code: "", headers: [], timeoutSec: 5 })).toThrow(TypeError);
    expect(workers).toHaveLength(0);
  });

  it("loads the artifact, starts after ready, and reports running only with the confirmation", () => {
    const { runtime, worker, ev, statuses } = setup();

    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });
    const load = worker().last("load");
    expect(load).toMatchObject({ board: "uno", artifactBoard: "uno", buildId: artifact.buildId, sha256: artifact.sha256, symbols: artifact.symbols });
    expect([...new Uint8Array(load.flash)]).toEqual([1, 2, 3, 4]);
    expect(worker().transfers[0]).toEqual([load.flash]); // transferred, not copied
    expect(worker().sent.map((command) => command.type)).toEqual(["load"]);

    worker().emit(ev(load.runId, { type: "ready", protocolVersion: 1, board: "uno", buildId: artifact.buildId }));
    const start = worker().last("start");
    expect(start.timeoutMs).toBe(30_000);
    expect(start.runId).toBeGreaterThan(load.runId);
    expect(statuses()).toEqual([]);

    worker().emit(ev(start.runId, { type: "status", state: "running" }));
    expect(statuses()).toEqual(["running"]);
  });

  it("passes the selected board along so the worker can refuse a mismatching artifact", () => {
    const { runtime, worker } = setup();

    runtime.start({ kind: "browser", artifact, board: "nano", timeoutSec: 5 });

    expect(worker().last("load")).toMatchObject({ board: "nano", artifactBoard: "uno" });
  });

  it("drops events of other runs", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;

    worker().emit(ev(runId + 7, { type: "serial", port: 0, text: "stale" }));
    worker().emit(ev(runId - 1, { type: "status", state: "stopped" }));

    expect(events).toEqual([]);
  });

  it("turns serial output, pins and findings into the events the handler knows", () => {
    const { startRunning, worker, ev, events, timers } = setup();
    const runId = startRunning();
    events.length = 0;
    timers.time = 1234;

    worker().emit(ev(runId, { type: "serial", port: 0, text: "Hello\r\n" }));
    worker().emit(ev(runId, { type: "pins", changeCount: 2, changes: [{ pin: 13, mode: "OUTPUT", level: 1 }, { pin: 9, mode: "OUTPUT", level: 1, pwm: 128 }] }));
    worker().emit(ev(runId, { type: "usage", usages: [{ pin: 13, fn: "pinMode", mode: "OUTPUT" }] }));

    expect(events).toContainEqual({ type: "serial_output", data: "Hello\n", isComplete: true });
    expect(events).toEqual([
      { type: "serial_output", data: "Hello\n", isComplete: true },
      {
        type: "pin_state_batch",
        timestamp: 1234,
        states: [
          { pin: 13, stateType: "mode", value: 1 }, { pin: 13, stateType: "value", value: 1 },
          { pin: 9, stateType: "mode", value: 1 }, { pin: 9, stateType: "value", value: 1 }, { pin: 9, stateType: "pwm", value: 128 },
        ],
      },
      { type: "runtime_usage", usages: [{ pin: 13, fn: "pinMode", mode: "OUTPUT" }] },
      { type: "io_registry", registry: [{ pin: "13", defined: true, pinMode: 1, usedAt: [{ line: 0, operation: "pinMode:1" }] }] },
    ]);
  });

  it("builds the I/O registry snapshot of the run from the findings, with analog pin names, and starts anew with each run", () => {
    const { startRunning, worker, ev, events, runtime } = setup();
    const runId = startRunning();
    events.length = 0;

    worker().emit(ev(runId, { type: "usage", usages: [{ pin: 9, fn: "pinMode", mode: "INPUT_PULLUP" }, { pin: 14, fn: "analogRead" }] }));
    worker().emit(ev(runId, { type: "usage", usages: [{ pin: 9, fn: "digitalRead" }] }));

    const snapshots = events.filter((event) => event.type === "io_registry");
    expect(snapshots.at(-1)).toEqual({
      type: "io_registry",
      registry: [
        { pin: "9", defined: true, pinMode: 2, usedAt: [{ line: 0, operation: "pinMode:2" }, { line: 0, operation: "digitalRead" }] },
        { pin: "A0", defined: false, usedAt: [{ line: 0, operation: "analogRead" }] },
      ],
    });

    runtime.start({ kind: "browser", artifact, timeoutSec: 5 });
    const second = worker().last("load");
    worker().emit(ev(second.runId, { type: "ready", protocolVersion: 1, board: "uno", buildId: artifact.buildId }));
    worker().emit(ev(worker().last("start").runId, { type: "status", state: "running" }));
    events.length = 0;
    worker().emit(ev(worker().last("start").runId, { type: "usage", usages: [{ pin: 4, fn: "digitalWrite" }] }));
    expect(events.filter((event) => event.type === "io_registry")).toEqual([
      { type: "io_registry", registry: [{ pin: "4", defined: false, usedAt: [{ line: 0, operation: "digitalWrite" }] }] },
    ]);
  });

  it("sends serial text like the server: lines end with LF, a partial line is not complete, a CR waits for its LF", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;
    const serialEvents = () => events.filter((event) => event.type === "serial_output");

    worker().emit(ev(runId, { type: "serial", port: 0, text: "count " }));
    worker().emit(ev(runId, { type: "serial", port: 0, text: "7\r" }));
    expect(serialEvents()).toEqual([
      { type: "serial_output", data: "count ", isComplete: false },
      { type: "serial_output", data: "7", isComplete: false },
    ]);

    worker().emit(ev(runId, { type: "serial", port: 0, text: "\ncount 8\r\nrest" }));
    expect(serialEvents().slice(2)).toEqual([{ type: "serial_output", data: "\ncount 8\nrest", isComplete: false }]);

    worker().emit(ev(runId, { type: "serial", port: 0, text: "\r\n" }));
    expect(serialEvents().at(-1)).toEqual({ type: "serial_output", data: "\n", isComplete: true });
  });

  it("names the port of serial output from Serial1 to Serial3 and keeps a waiting CR per port", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;
    const serialEvents = () => events.filter((event) => event.type === "serial_output");

    worker().emit(ev(runId, { type: "serial", port: 1, text: "S1 hello\r\n" }));
    worker().emit(ev(runId, { type: "serial", port: 2, text: "part\r" }));
    worker().emit(ev(runId, { type: "serial", port: 0, text: "zero\r" }));
    worker().emit(ev(runId, { type: "serial", port: 2, text: "\nrest" }));
    worker().emit(ev(runId, { type: "serial", port: 0, text: "\n" }));

    expect(serialEvents()).toEqual([
      { type: "serial_output", data: "S1 hello\n", isComplete: true, port: 1 },
      { type: "serial_output", data: "part", isComplete: false, port: 2 },
      { type: "serial_output", data: "zero", isComplete: false },
      { type: "serial_output", data: "\nrest", isComplete: false, port: 2 },
      { type: "serial_output", data: "\n", isComplete: true },
    ]);
  });

  it("sends serial input to the given port", () => {
    const { runtime, worker, startRunning } = setup();
    const runId = startRunning();

    runtime.sendSerial("to Serial2", 2);
    runtime.sendSerial("to Serial");

    expect(worker().sent.filter((command) => command.type === "serialIn")).toEqual([
      { type: "serialIn", runId, port: 2, text: "to Serial2" },
      { type: "serialIn", runId, port: 0, text: "to Serial" },
    ]);
  });

  it("does not repeat a pin state that did not change", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;
    const change = { pin: 13, mode: "OUTPUT", level: 1 } as const;

    worker().emit(ev(runId, { type: "pins", changeCount: 1, changes: [change] }));
    worker().emit(ev(runId, { type: "pins", changeCount: 1, changes: [change] }));
    worker().emit(ev(runId, { type: "pins", changeCount: 1, changes: [{ ...change, level: 0 }] }));

    expect(events.filter((event) => event.type === "pin_state_batch")).toHaveLength(2);
  });

  it("words diagnostics as a system line and also carries them, and telemetry, as events of their own", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;
    const diagnostic = { kind: "serial-input-discarded", port: 0, bytes: 3, simTimeMs: 5 } as const;

    worker().emit(ev(runId, { type: "diagnostic", diagnostic }));
    worker().emit(ev(runId, { type: "telemetry", simTimeMs: 1000, realTimeFactor: 1, pinChangesPerSecond: 4, serialCharsPerSecond: 9, serialCharsDropped: 0 }));

    expect(events).toEqual([
      { type: "serial_output", data: "--- Serial input discarded because the receiver was not enabled yet (Serial.begin() has not run) ---\n", isComplete: true },
      { type: "runtime_diagnostic", diagnostic },
      { type: "runtime_telemetry", sample: { simTimeMs: 1000, realTimeFactor: 1, pinChangesPerSecond: 4, serialCharsPerSecond: 9, serialCharsDropped: 0 } },
    ]);
  });

  it("pauses and resumes with the server's system lines, and only after the confirmation", () => {
    const { runtime, startRunning, worker, ev, statuses, lines } = setup();
    const runId = startRunning();

    runtime.pause();
    expect(worker().last("pause").runId).toBe(runId);
    expect(statuses()).toEqual(["running"]);
    worker().emit(ev(runId, { type: "status", state: "paused" }));
    runtime.resume();
    worker().emit(ev(runId, { type: "status", state: "running" }));

    expect(statuses()).toEqual(["running", "paused", "running"]);
    expect(lines()).toEqual([SYSTEM_LINES.paused, SYSTEM_LINES.resumed]);
  });

  it("ignores pause while not running and resume while not paused", () => {
    const { runtime, startRunning, worker } = setup();
    runtime.pause(); // nothing started
    startRunning();
    const sent = worker().sent.length;

    runtime.resume();

    expect(worker().sent).toHaveLength(sent);
  });

  it("resets the CPU under a new runId without loading again", () => {
    const { runtime, startRunning, worker, ev, statuses } = setup();
    const runId = startRunning();

    runtime.reset();
    const reset = worker().last("reset");
    expect(reset.runId).toBeGreaterThan(runId);
    expect(worker().sent.filter((command) => command.type === "load")).toHaveLength(1);
    worker().emit(ev(runId, { type: "serial", port: 0, text: "old run" })); // late event of the run before the reset
    worker().emit(ev(reset.runId, { type: "status", state: "running" }));

    expect(statuses()).toEqual(["running", "running"]);
  });

  it("starts the I/O findings of the run anew with a reset, because the new machine reports its first uses again", () => {
    const { runtime, startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    worker().emit(ev(runId, { type: "usage", usages: [{ pin: 4, fn: "digitalWrite" }] }));

    runtime.reset();
    const reset = worker().last("reset");
    worker().emit(ev(reset.runId, { type: "status", state: "running" }));
    events.length = 0;
    worker().emit(ev(reset.runId, { type: "usage", usages: [{ pin: 4, fn: "digitalWrite" }] }));

    expect(events.find((event) => event.type === "io_registry")).toEqual({
      type: "io_registry",
      registry: [{ pin: "4", defined: false, usedAt: [{ line: 0, operation: "digitalWrite" }] }],
    });
  });

  it("names the pins of the run's board in the registry: A6 on the Nano", () => {
    const { runtime, worker, ev, events } = setup();
    runtime.start({ kind: "browser", artifact: { ...artifact, board: "nano" }, timeoutSec: 5 });
    const load = worker().last("load");
    worker().emit(ev(load.runId, { type: "ready", protocolVersion: 1, board: "nano", buildId: artifact.buildId }));
    const start = worker().last("start");
    worker().emit(ev(start.runId, { type: "status", state: "running" }));
    events.length = 0;

    worker().emit(ev(start.runId, { type: "usage", usages: [{ pin: 20, fn: "analogRead" }, { pin: 14, fn: "analogRead" }] }));

    expect(events.find((event) => event.type === "io_registry")).toEqual({
      type: "io_registry",
      registry: [
        { pin: "A6", defined: false, usedAt: [{ line: 0, operation: "analogRead" }] },
        { pin: "A0", defined: false, usedAt: [{ line: 0, operation: "analogRead" }] },
      ],
    });
  });

  it("sends serial input to port 0 in chunks, only while running", () => {
    const { runtime, worker, startRunning } = setup();
    runtime.sendSerial("too early");
    const runId = startRunning();

    runtime.sendSerial("a".repeat(2500));
    runtime.setPin(2, 1);
    runtime.setPin(3, 0);
    runtime.setAnalog(14, 512);

    const serial = worker().sent.filter((command) => command.type === "serialIn");
    expect(serial.map((command) => (command as { text: string }).text.length)).toEqual([1024, 1024, 452]);
    expect(serial.every((command) => command.runId === runId && (command as { port: number }).port === 0)).toBe(true);
    expect(worker().sent.slice(-3)).toEqual([
      { type: "setDigital", runId, pin: 2, level: 1 },
      { type: "setDigital", runId, pin: 3, level: 0 },
      { type: "setAnalog", runId, pin: 14, value: 512 },
    ]);
  });

  it("stops at once for the UI and ends later events of the run", () => {
    const { runtime, startRunning, worker, ev, statuses, lines, events } = setup();
    const runId = startRunning();

    runtime.stop();
    expect(worker().last("stop").runId).toBe(runId);
    expect(statuses()).toEqual(["running", "stopped"]);
    expect(lines()).toEqual([SYSTEM_LINES.stopped]);
    events.length = 0;
    worker().emit(ev(runId, { type: "serial", port: 0, text: "late" }));
    worker().emit(ev(runId, { type: "status", state: "stopped", reason: "stop" }));

    expect(events).toEqual([]);
    expect(worker().terminated).toBe(false); // the worker stays for the next run
  });

  it("terminates a worker that does not confirm stop in time, and creates a new one for the next run", () => {
    const { runtime, startRunning, workers, timers } = setup();
    startRunning();

    runtime.stop();
    timers.advance(DEFAULT_SUPERVISION.stopMs);
    expect(workers[0].terminated).toBe(true);

    startRunning();
    expect(workers).toHaveLength(2);
  });

  it("reports the end of the run by the worker, with the timeout line", () => {
    const { startRunning, worker, ev, statuses, lines } = setup();
    const runId = startRunning(12);

    worker().emit(ev(runId, { type: "status", state: "stopped", reason: "timeout" }));

    expect(statuses()).toEqual(["running", "stopped"]);
    expect(lines()).toEqual(["--- Simulation timeout (12s) ---\n"]);
  });

  it("turns a fault into an error and a stop", () => {
    const { startRunning, worker, ev, events } = setup();
    const runId = startRunning();
    events.length = 0;

    worker().emit(ev(runId, { type: "fault", message: "the artifact is built for uno" }));
    worker().emit(ev(runId, { type: "status", state: "stopped", reason: "fault" }));

    expect(events).toEqual([
      { type: "operation_error", operation: "start_simulation", code: "RUNTIME_FAILED", message: "the artifact is built for uno" },
      { type: "simulation_status", status: "stopped" },
    ]);
  });

  it.each([
    ["error", (worker: FakeWorker) => worker.fail("boom"), /worker failed: boom/],
    ["messageerror", (worker: FakeWorker) => worker.failMessage(), /could not be read/],
  ])("ends the run and terminates the worker on %s", (_name, trigger, message) => {
    const { startRunning, worker, statuses, events } = setup();
    startRunning();

    trigger(worker());

    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["running", "stopped"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "operation_error", code: "RUNTIME_FAILED", message: expect.stringMatching(message) }));
  });

  it("ends a start whose worker never becomes ready", () => {
    const { runtime, worker, timers, statuses, events } = setup();
    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });

    timers.advance(DEFAULT_SUPERVISION.readyMs - 1);
    expect(statuses()).toEqual([]);
    timers.advance(1);

    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["stopped"]);
    expect(events).toContainEqual(expect.objectContaining({ code: "RUNTIME_FAILED", message: "the emulator did not become ready" }));
  });

  it("does not apply the heartbeat deadline while the worker module is still loading", () => {
    const { runtime, worker, timers, statuses } = setup();
    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });

    timers.advance(DEFAULT_SUPERVISION.heartbeatMs * 3);

    expect(statuses()).toEqual([]);
    expect(worker().terminated).toBe(false);
  });

  it("ends a start that is not confirmed", () => {
    const { runtime, worker, ev, timers, statuses } = setup();
    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });
    worker().emit(ev(worker().last("load").runId, { type: "ready", protocolVersion: 1, board: "uno", buildId: artifact.buildId }));

    timers.advance(DEFAULT_SUPERVISION.confirmMs);

    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["stopped"]);
  });

  it("ends a pause that is not confirmed", () => {
    const { runtime, startRunning, worker, timers, statuses } = setup();
    startRunning();

    runtime.pause();
    timers.advance(DEFAULT_SUPERVISION.confirmMs);

    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["running", "stopped"]);
  });

  it("terminates a worker without heartbeat, and keeps one that sends heartbeats, also while paused", () => {
    const { runtime, startRunning, worker, ev, timers, statuses } = setup();
    const runId = startRunning();
    runtime.pause();
    worker().emit(ev(runId, { type: "status", state: "paused" }));

    for (let i = 0; i < 12; i++) {
      timers.advance(500);
      worker().emit(ev(runId, { type: "heartbeat", simTimeMs: i }));
    }
    expect(statuses()).toEqual(["running", "paused"]);

    timers.advance(DEFAULT_SUPERVISION.heartbeatMs + 1000);
    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["running", "paused", "stopped"]);
  });

  it("starting again replaces the run: the old one stops, the new one gets a higher runId", () => {
    const { runtime, startRunning, worker, statuses } = setup();
    const first = startRunning();

    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });

    expect(statuses()).toEqual(["running", "stopped"]);
    expect(worker().last("load").runId).toBeGreaterThan(first);
  });

  it("stops while still loading without asking the worker, and disposes cleanly", () => {
    const { runtime, worker, statuses } = setup();
    runtime.start({ kind: "browser", artifact, timeoutSec: 30 });

    runtime.stop();
    expect(worker().terminated).toBe(true);
    expect(statuses()).toEqual(["stopped"]);

    runtime.dispose();
    runtime.stop(); // no effect after dispose
  });

  it("stops forwarding after unsubscribe", () => {
    const { runtime, startRunning } = setup();
    const seen: AnyRuntimeEvent[] = [];
    const unsubscribe = runtime.subscribe((event) => seen.push(event));
    unsubscribe();

    startRunning();

    expect(seen).toEqual([]);
  });
});

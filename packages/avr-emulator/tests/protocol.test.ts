import { describe, expect, it } from "vitest";
import { COMMAND_LIMITS, type Command, type RunEvent, RunGate, parseCommand } from "../src/index";

const flash = new Uint8Array([1, 2, 3, 4]).buffer;
const load = { type: "load", runId: 1, board: "uno", artifactBoard: "uno", buildId: "build-1", sha256: "a".repeat(64), flash, symbols: { functions: {}, data: {} } };

describe("parseCommand (plan 4.5, P1.11)", () => {
  it.each<[string, unknown]>([
    ["load", load],
    ["start", { type: "start", runId: 2, timeoutMs: 60_000 }],
    ["pause", { type: "pause", runId: 2 }],
    ["resume", { type: "resume", runId: 2 }],
    ["stop", { type: "stop", runId: 2 }],
    ["reset", { type: "reset", runId: 3 }],
    ["serialIn", { type: "serialIn", runId: 2, port: 0, text: "ä€😀\n" }],
    ["setDigital", { type: "setDigital", runId: 2, pin: 7, level: 1 }],
    ["setAnalog", { type: "setAnalog", runId: 2, pin: 14, value: 1023 }],
  ])("accepts a valid %s command", (_name, message) => {
    const result = parseCommand(message);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command.type).toBe((message as Command).type);
  });

  it("keeps only the fields of the schema", () => {
    const result = parseCommand({ type: "stop", runId: 4, extra: "ignored" });

    expect(result).toEqual({ ok: true, command: { type: "stop", runId: 4 } });
  });

  it.each<[string, unknown]>([
    ["a non-object", "start"],
    ["null", null],
    ["an array", []],
    ["an unknown command", { type: "eval", runId: 1 }],
    ["an inherited command name", { type: "constructor", runId: 1 }],
    ["a missing runId", { type: "stop" }],
    ["a negative runId", { type: "stop", runId: -1 }],
    ["a fractional runId", { type: "stop", runId: 1.5 }],
    ["a string runId", { type: "stop", runId: "1" }],
    ["a timeout below 1 s", { type: "start", runId: 1, timeoutMs: COMMAND_LIMITS.minTimeoutMs - 1 }],
    ["a timeout above 300 s", { type: "start", runId: 1, timeoutMs: COMMAND_LIMITS.maxTimeoutMs + 1 }],
    ["a missing timeout", { type: "start", runId: 1 }],
    ["an unknown board", { ...load, board: "esp32" }],
    ["an unknown artifact board", { ...load, artifactBoard: "esp32" }],
    ["a missing artifact board", { ...load, artifactBoard: undefined }],
    ["an empty buildId", { ...load, buildId: "" }],
    ["a malformed sha256", { ...load, sha256: "xyz" }],
    ["flash that is not an ArrayBuffer", { ...load, flash: new Uint8Array(4) }],
    ["empty flash", { ...load, flash: new ArrayBuffer(0) }],
    ["flash above the largest MCU", { ...load, flash: new ArrayBuffer(COMMAND_LIMITS.maxFlashBytes + 1) }],
    ["symbols that are not an object", { ...load, symbols: 5 }],
    ["a serial port above 3", { type: "serialIn", runId: 1, port: 4, text: "x" }],
    ["empty serial text", { type: "serialIn", runId: 1, port: 0, text: "" }],
    ["serial text above 4 KiB", { type: "serialIn", runId: 1, port: 0, text: "x".repeat(4097) }],
    ["serial text above 4 KiB once encoded", { type: "serialIn", runId: 1, port: 0, text: "€".repeat(1400) }],
    ["a digital level of 2", { type: "setDigital", runId: 1, pin: 3, level: 2 }],
    ["a boolean digital level", { type: "setDigital", runId: 1, pin: 3, level: true }],
    ["a negative pin", { type: "setDigital", runId: 1, pin: -1, level: 0 }],
    ["an analog value above 1023", { type: "setAnalog", runId: 1, pin: 14, value: 1024 }],
    ["a fractional analog value", { type: "setAnalog", runId: 1, pin: 14, value: 0.5 }],
  ])("discards %s", (_name, message) => {
    const result = parseCommand(message);

    expect(result.ok).toBe(false);
  });
});

const event = (runId: number, rest: Record<string, unknown>): RunEvent => ({ runId, ...rest }) as RunEvent;

describe("RunGate (plan 4.5: run identification)", () => {
  it("begins a new run with load, start and reset only", () => {
    const gate = new RunGate();

    const load1 = gate.runIdFor("load");
    expect(gate.runIdFor("pause")).toBe(load1);
    expect(gate.runIdFor("serialIn")).toBe(load1);
    const start = gate.runIdFor("start");
    expect(start).toBeGreaterThan(load1);
    expect(gate.runIdFor("setDigital")).toBe(start);
    const reset = gate.runIdFor("reset");
    expect(reset).toBeGreaterThan(start);
    expect(gate.runId).toBe(reset);
  });

  it("discards late events of a stopped, reset or replaced run", () => {
    const gate = new RunGate();
    const first = gate.runIdFor("start");
    expect(gate.accept(event(first, { type: "serial", port: 0, text: "a" }))).toBe(true);

    const second = gate.runIdFor("reset");
    expect(gate.accept(event(first, { type: "serial", port: 0, text: "late" }))).toBe(false);
    expect(gate.accept(event(first, { type: "pins", changes: [], changeCount: 0 }))).toBe(false);
    expect(gate.accept(event(second, { type: "serial", port: 0, text: "b" }))).toBe(true);

    gate.end();
    expect(gate.accept(event(second, { type: "serial", port: 0, text: "after stop" }))).toBe(false);
    const third = gate.runIdFor("start");
    expect(gate.accept(event(second, { type: "status", state: "stopped" }))).toBe(false);
    expect(gate.accept(event(third, { type: "status", state: "running" }))).toBe(true);
  });

  it("takes running and paused over only with the confirmation of the current run", () => {
    const gate = new RunGate();
    const run = gate.runIdFor("start");
    expect(gate.state).toBeUndefined();

    gate.runIdFor("pause"); // the command alone changes nothing
    expect(gate.state).toBeUndefined();
    gate.accept(event(run, { type: "status", state: "running" }));
    expect(gate.state).toBe("running");
    gate.accept(event(run + 5, { type: "status", state: "paused" })); // another run: ignored
    expect(gate.state).toBe("running");
    gate.accept(event(run, { type: "status", state: "paused" }));
    expect(gate.state).toBe("paused");
  });

  it("stop takes effect at once without waiting for the confirmation", () => {
    const gate = new RunGate();
    const run = gate.runIdFor("start");
    gate.accept(event(run, { type: "status", state: "running" }));

    gate.end();

    expect(gate.state).toBe("stopped");
    expect(gate.runId).toBeUndefined();
  });
});

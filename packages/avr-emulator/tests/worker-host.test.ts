import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type RunEvent, WorkerHost, buildSimulationImage, decodeBase64, installWorker } from "../src/index";
import { FakeClock } from "./fake-clock";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

function artifact(name = "uno-tick_probe", board = "uno") {
  const image = buildSimulationImage({ board: board as "uno", hex: fixture(`${name}.hex`).toString("utf8") });
  const bytes = decodeBase64(image.flashBase64);
  return { flash: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, sha256: image.sha256, symbols: image.symbols };
}

function setup({ cost = 0 } = {}) {
  const events: RunEvent[] = [];
  let host: WorkerHost | undefined;
  const clock = new FakeClock(() => host?.simTimeMs ?? 0);
  clock.costPerSimMs = cost;
  host = new WorkerHost({ clock, post: (event) => events.push(event) });
  const send = (message: Record<string, unknown>) => host.handleMessage(message);
  const load = (runId: number, extra: Record<string, unknown> = {}, name?: string) =>
    send({ type: "load", runId, board: "uno", artifactBoard: "uno", buildId: "build-1", ...artifact(name), ...extra });
  const take = () => events.splice(0);
  return { host, clock, events, send, load, take };
}

const byType = (events: RunEvent[], type: string) => events.filter((e) => e.type === type);
const serialText = (events: RunEvent[]) => byType(events, "serial").map((e) => (e as { text: string }).text).join("").replaceAll("\r\n", "\n");

describe("WorkerHost (plan 4.5, P1.12)", () => {
  it("answers load with ready and starts nothing", () => {
    const { load, take, clock } = setup();

    load(1);
    clock.runUntil(100);

    expect(take().filter((e) => e.type !== "heartbeat")).toEqual([{ type: "ready", protocolVersion: PROTOCOL_VERSION, board: "uno", buildId: "build-1", runId: 1 }]);
  });

  it("runs the sketch: status running, serial text, pins and telemetry under the run id", () => {
    const { load, send, take, clock } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    send({ type: "setDigital", runId: 2, pin: 2, level: 1 });
    clock.runUntil(1100);
    const events = take();

    expect(events.every((e) => e.runId === (e.type === "ready" ? 1 : 2))).toBe(true);
    expect(byType(events, "status")).toEqual([{ type: "status", state: "running", runId: 2 }]);
    expect(serialText(events)).toMatch(/^0 \d+\n1 \d+\n/);
    expect(byType(events, "pins")[0]).toMatchObject({ changes: [expect.objectContaining({ pin: 2, level: 1 })] });
    expect(byType(events, "telemetry").length).toBeGreaterThanOrEqual(1);
  });

  it("sends a heartbeat about every 500 ms, also while paused, and holds simulated time", () => {
    const { load, send, take, clock, host } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(200);
    send({ type: "pause", runId: 2 });
    const pausedAt = host.simTimeMs;
    take();
    clock.runUntil(2200);
    const events = take();

    expect(byType(events, "heartbeat").length).toBeGreaterThanOrEqual(3);
    expect(byType(events, "heartbeat").every((e) => (e as { simTimeMs: number }).simTimeMs === pausedAt)).toBe(true);
    expect(host.simTimeMs).toBe(pausedAt);
  });

  it("confirms pause, resume and stop with status events", () => {
    const { load, send, take, clock } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(50);
    take();

    send({ type: "pause", runId: 2 });
    expect(byType(take(), "status")).toMatchObject([{ state: "paused" }]);
    send({ type: "resume", runId: 2 });
    expect(byType(take(), "status")).toMatchObject([{ state: "running" }]);
    clock.runUntil(120);
    take();
    send({ type: "stop", runId: 2 });
    const stopped = byType(take(), "status");
    expect(stopped).toMatchObject([{ state: "stopped", reason: "stop", runId: 2 }]);
    clock.runUntil(1000);
    expect(byType(take(), "serial")).toEqual([]); // nothing runs after stop
  });

  it("ends the run with the timeout after wall-clock time without pauses", () => {
    const { load, send, take, clock } = setup({ cost: 10 }); // real-time factor 0.1: 1 s wall is 100 ms of sketch
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 1000 });
    clock.runUntil(1500);

    const status = byType(take(), "status").at(-1);
    expect(status).toMatchObject({ state: "stopped", reason: "timeout" });
    expect((status as { simTimeMs: number }).simTimeMs).toBeLessThan(400);
  });

  it("resets with a new run id and goes on", () => {
    const { load, send, take, clock } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(100);
    take();

    send({ type: "reset", runId: 3 });
    clock.runUntil(200);
    const events = take();

    expect(byType(events, "status")).toEqual([{ type: "status", state: "running", runId: 3 }]);
    expect(serialText(events.filter((e) => e.runId === 3))).toMatch(/^0 \d+\n/);
  });

  it("discards invalid commands, stale run ids and run-starting commands with a lower id", () => {
    const { load, send, take, clock } = setup();
    load(5);
    send({ type: "start", runId: 6, timeoutMs: 60_000 });
    clock.runUntil(60);
    take();

    send({ type: "pause", runId: 5 }); // stale
    send({ type: "stop", runId: 99 }); // not the current run
    send({ type: "reset", runId: 6 }); // not higher
    send({ type: "eval", runId: 6 });
    send({ type: "setAnalog", runId: 6, pin: 14, value: 5000 });
    send({ type: "serialIn", runId: 6, port: 9, text: "x" });
    clock.runUntil(100);
    const events = take();

    expect(byType(events, "status")).toEqual([]);
    expect(serialText(events).length).toBeGreaterThan(0); // still running
  });

  it("refuses an artifact for another board than the selected one", () => {
    const { load, take } = setup();

    load(1, { artifactBoard: "nano" });

    expect(take()).toEqual([
      { type: "fault", message: "the artifact is built for nano, the selected board is uno", runId: 1 },
      { type: "status", state: "stopped", reason: "fault", runId: 1 },
    ]);
  });

  it("refuses flash whose SHA-256 does not match", () => {
    const { load, take } = setup();

    load(1, { sha256: "0".repeat(64) });

    expect(byType(take(), "fault")).toMatchObject([{ message: expect.stringMatching(/SHA-256/) }]);
  });

  it("replaces the machine on load without events of the old run", () => {
    const { load, send, take, clock } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(100);
    take();

    load(3);
    clock.runUntil(300);
    const events = take();

    expect(byType(events, "status")).toEqual([]); // the replaced run does not report "stopped"
    expect(events.filter((e) => e.runId === 2 && e.type !== "serial" && e.type !== "pins")).toEqual([]);
    expect(byType(events, "ready")).toHaveLength(1);
  });

  it("stays usable between runs", () => {
    const { load, send, take, clock } = setup();
    load(1);
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(50);
    send({ type: "stop", runId: 2 });
    take();

    load(3);
    send({ type: "start", runId: 4, timeoutMs: 60_000 });
    clock.runUntil(100);

    expect(byType(take(), "status")).toMatchObject([{ state: "running", runId: 4 }]);
  });

  it("stops an unstarted machine on request", () => {
    const { load, send, take } = setup();
    load(1);
    take();

    send({ type: "stop", runId: 1 });

    expect(byType(take(), "status")).toMatchObject([{ state: "stopped", reason: "stop", runId: 1 }]);
  });

  it("delivers serial input to the sketch", () => {
    const { load, send, take, clock } = setup();
    load(1, {}, "uno-serial_probe");
    send({ type: "start", runId: 2, timeoutMs: 60_000 });
    clock.runUntil(100);
    expect(serialText(take())).toContain("Grüße: äöü € 😀");

    send({ type: "serialIn", runId: 2, port: 0, text: "42\n" });
    clock.runUntil(400);

    expect(serialText(take())).toMatch(/n=42 after \d+ ms/);
  });
});

describe("installWorker", () => {
  it("connects a worker scope: messages in, events out", () => {
    const posted: unknown[] = [];
    let listener: ((event: { data: unknown }) => void) | undefined;
    const clock = new FakeClock();

    installWorker({ postMessage: (m) => posted.push(m), addEventListener: (_type, l) => { listener = l; } }, clock);
    listener?.({ data: { type: "load", runId: 1, board: "uno", artifactBoard: "uno", buildId: "b", ...artifact() } });

    expect(posted).toEqual([{ type: "ready", protocolVersion: PROTOCOL_VERSION, board: "uno", buildId: "b", runId: 1 }]);
  });
});

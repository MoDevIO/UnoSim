import { describe, expect, it } from "vitest";
import { EventBatcher, type PinSnapshot, type RunEvent } from "../src/index";

const pin = (n: number, level: 0 | 1, pwm?: number): PinSnapshot => ({ pin: n, mode: "OUTPUT", level, ...(pwm === undefined ? {} : { pwm }) });
const context = (runId = 1) => ({ runId, simTimeMs: 100, realTimeFactor: 1 });

function setup(options: Partial<ConstructorParameters<typeof EventBatcher>[0]> = {}) {
  let time = 0;
  const batcher = new EventBatcher({ now: () => time, ...options });
  return { batcher, advance: (ms: number) => { time += ms; } };
}

const types = (events: RunEvent[]) => events.map((e) => e.type);

describe("EventBatcher (plan 4.5, P1.11)", () => {
  it("merges pins to the last state per pin and counts all changes", () => {
    const { batcher } = setup();
    batcher.addPins({ changes: [pin(13, 1), pin(9, 0, 10)], changeCount: 2 });
    batcher.addPins({ changes: [pin(13, 0), pin(9, 0, 200)], changeCount: 2 });

    const events = batcher.flush(context());

    expect(events).toEqual([{ type: "pins", changes: [pin(9, 0, 200), pin(13, 0)], changeCount: 4, runId: 1 }]);
  });

  it("joins serial text per port into coherent text and keeps the order relative to diagnostics", () => {
    const { batcher } = setup();
    batcher.addSerial([{ port: 0, text: "Hel" }, { port: 0, text: "lo " }]);
    batcher.addDiagnostics([{ kind: "watchdog-reset", simTimeMs: 5 }]);
    batcher.addSerial([{ port: 0, text: "after" }, { port: 1, text: "other" }]);

    const events = batcher.flush(context());

    expect(events.map((e) => (e.type === "serial" ? `${e.port}:${e.text}` : e.type))).toEqual(["0:Hello ", "diagnostic", "0:after", "1:other"]);
  });

  it("sends at most one group per interval, about 60 per second", () => {
    const { batcher, advance } = setup();
    let groups = 0;
    for (let step = 0; step < 1000; step++) { // 1 s in 1 ms steps, input at every step
      batcher.addSerial([{ port: 0, text: "x" }]);
      if (batcher.flush(context()).length > 0) groups++;
      advance(1);
    }

    expect(groups).toBeGreaterThanOrEqual(55);
    expect(groups).toBeLessThanOrEqual(63);
  });

  it("keeps pending data until the interval has passed and loses nothing", () => {
    const { batcher, advance } = setup();
    batcher.addSerial([{ port: 0, text: "a" }]);
    expect(batcher.flush(context())).toHaveLength(1);
    batcher.addSerial([{ port: 0, text: "b" }]);

    expect(batcher.ready).toBe(false);
    expect(batcher.flush(context())).toEqual([]);
    advance(20);
    expect(batcher.ready).toBe(true);
    expect(batcher.flush(context())).toEqual([{ type: "serial", port: 0, text: "b", runId: 1 }]);
  });

  it("returns nothing when nothing is pending", () => {
    expect(setup().batcher.flush(context())).toEqual([]);
  });

  it("creates telemetry once per second with rates and the dropped count", () => {
    const { batcher, advance } = setup();
    batcher.addPins({ changes: [pin(2, 1)], changeCount: 40 });
    batcher.addSerial([{ port: 0, text: "x".repeat(100) }]);
    advance(500);
    expect(types(batcher.flush(context()))).not.toContain("telemetry");

    advance(500);
    const events = batcher.flush({ runId: 1, simTimeMs: 1000, realTimeFactor: 0.5 });
    const telemetry = events.find((e) => e.type === "telemetry");

    expect(telemetry).toMatchObject({ simTimeMs: 1000, realTimeFactor: 0.5, pinChangesPerSecond: 40, serialCharsPerSecond: 100, serialCharsDropped: 0 });
    advance(1000);
    expect(batcher.flush(context()).map((e) => e.type)).toEqual(["telemetry"]); // alone, rates back to zero
  });

  it("bounds the pending serial text and reports what it dropped", () => {
    const { batcher, advance } = setup({ maxPendingSerialChars: 10 });
    batcher.addSerial([{ port: 0, text: "0123456789ABC" }, { port: 0, text: "more" }]);
    advance(1000);

    const events = batcher.flush(context());

    expect(events.find((e) => e.type === "serial")).toMatchObject({ text: "0123456789" });
    expect(events.find((e) => e.type === "telemetry")).toMatchObject({ serialCharsDropped: 7 });
  });

  it("splits long serial text into events of bounded size", () => {
    const { batcher } = setup({ maxSerialChunkChars: 4 });
    batcher.addSerial([{ port: 0, text: "abcdefghij" }]);

    const texts = batcher.flush(context()).map((e) => (e.type === "serial" ? e.text : ""));

    expect(texts).toEqual(["abcd", "efgh", "ij"]);
  });

  it("bounds the pending diagnostics and status entries", () => {
    const { batcher } = setup({ maxPendingEntries: 3 });
    for (let i = 0; i < 10; i++) batcher.addStatus("running");

    expect(batcher.flush(context())).toHaveLength(3);
  });

  it("reports usage, status and fault with the run id and discards on request", () => {
    const { batcher } = setup();
    batcher.addUsages([{ pin: 13, fn: "pinMode", mode: "OUTPUT" }]);
    batcher.addStatus("stopped", { reason: "timeout", simTimeMs: 12 });
    batcher.addFault("boom");

    expect(batcher.flush(context(7))).toEqual([
      { type: "status", state: "stopped", reason: "timeout", simTimeMs: 12, runId: 7 },
      { type: "fault", message: "boom", runId: 7 },
      { type: "usage", usages: [{ pin: 13, fn: "pinMode", mode: "OUTPUT" }], runId: 7 },
    ]);
    batcher.addSerial([{ port: 0, text: "x" }]);
    batcher.discard();
    expect(batcher.flush(context())).toEqual([]);
  });
});

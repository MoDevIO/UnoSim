import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Emulator, type StopInfo, buildSimulationImage, loadSimulationImage } from "../src/index";
import { FakeClock } from "./fake-clock";

function setup(hexFile: string, { cost = 0.25, timeoutMs = 60_000 } = {}) {
  const hex = readFileSync(join(__dirname, "fixtures", hexFile), "utf8");
  const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex }));
  const stops: StopInfo[] = [];
  let emulator: Emulator | undefined;
  const clock = new FakeClock(() => emulator?.simTimeMs ?? 0);
  clock.costPerSimMs = cost;
  emulator = new Emulator(image, { clock, timeoutMs, onStop: (info) => stops.push(info) });
  let text = "";
  const output = () => {
    text += emulator.takeSerialOutput().map((chunk) => chunk.text).join("");
    return text.replaceAll("\r\n", "\n");
  };
  return { emulator, clock, stops, output };
}

/** Parses the tick probe lines "<n> <millis>". */
const ticks = (text: string) =>
  text.split("\n").filter((line) => /^\d+ \d+$/.test(line)).map((line) => line.split(" ").map(Number) as [number, number]);

describe("Emulator timing (plan 4.7, P1.8)", () => {
  it("measures delay(587) as 586–587 ms like the Uno", () => {
    const { emulator, clock, output } = setup("uno-delay_probe.hex");
    emulator.start();
    clock.runUntil(620);

    const measured = Number(/delay\(587\) = (\d+)/.exec(output())?.[1]);
    expect(measured).toBeGreaterThanOrEqual(586);
    expect(measured).toBeLessThanOrEqual(587);
  });

  it("waits for the next appointment when ahead instead of computing on", () => {
    const { emulator, clock } = setup("uno-tick_probe.hex", { cost: 0.25 });
    emulator.start();
    clock.runUntil(200);

    expect(emulator.simTimeMs).toBeGreaterThan(195);
    expect(emulator.simTimeMs).toBeLessThan(205);
    expect(clock.waits).toBeGreaterThan(20);
    expect(emulator.realTimeFactor).toBeCloseTo(1, 1);
  });

  it("stops simulated time and millis() while paused", () => {
    const { emulator, clock, output } = setup("uno-tick_probe.hex");
    emulator.start();
    clock.runUntil(100);
    emulator.pause();
    const pausedAt = emulator.simTimeMs;
    clock.runUntil(1100);
    expect(emulator.simTimeMs).toBe(pausedAt);
    emulator.resume();
    clock.runUntil(1200);

    const lines = ticks(output());
    const gaps = lines.slice(1).map(([, ms], i) => ms - lines[i][1]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(11); // no 1000 ms jump
    // At most one wait (4 ms) plus one slice behind the wall clock.
    expect(lines.at(-1)?.[1]).toBeGreaterThan(180);
    expect(emulator.simTimeMs).toBeGreaterThan(188);
    expect(emulator.simTimeMs).toBeLessThan(205);
    expect(emulator.wallTimeMs).toBeCloseTo(200, -1);
  });

  it("resets the wall-clock reference after a backlog without skipping cycles, overflows or bytes", () => {
    const { emulator, clock, output } = setup("uno-tick_probe.hex", { cost: 3 }); // real-time factor 1/3
    emulator.start();
    clock.runUntil(600);

    expect(emulator.simTimeMs).toBeGreaterThan(190);
    expect(emulator.simTimeMs).toBeLessThan(210);
    expect(emulator.realTimeFactor).toBeCloseTo(1 / 3, 1);
    expect(emulator.machine.cpu.cycles).toBe(Math.round((emulator.simTimeMs * 16_000_000) / 1000));
    const lines = ticks(output());
    expect(lines.map(([n]) => n)).toEqual(lines.map((_, i) => i)); // every line, none lost
    // millis() follows the cycle counter: no timer-0 overflow interrupt was lost.
    expect(emulator.simTimeMs - (lines.at(-1)?.[1] ?? 0)).toBeLessThan(11);
  });

  it("ends a run with real-time factor 0.5 after half the simulated time and reports both times", () => {
    const { emulator, clock, stops } = setup("uno-tick_probe.hex", { cost: 2, timeoutMs: 400 });
    emulator.start();
    clock.runUntil(1000);

    expect(emulator.state).toBe("stopped");
    expect(stops).toHaveLength(1);
    expect(stops[0].reason).toBe("timeout");
    expect(stops[0].wallTimeMs).toBeGreaterThanOrEqual(400);
    expect(stops[0].wallTimeMs).toBeLessThan(412);
    expect(stops[0].simTimeMs).toBeGreaterThan(195);
    expect(stops[0].simTimeMs).toBeLessThan(206);
  });

  it("does not count paused time towards the timeout", () => {
    const { emulator, clock, stops } = setup("uno-tick_probe.hex", { timeoutMs: 150 });
    emulator.start();
    clock.runUntil(100);
    emulator.pause();
    clock.runUntil(5000);
    emulator.resume();
    clock.runUntil(5040);
    expect(emulator.state).toBe("running");
    clock.runUntil(5100);

    expect(stops.map((s) => s.reason)).toEqual(["timeout"]);
    expect(stops[0].wallTimeMs).toBeLessThan(160);
  });
});

describe("Emulator lifecycle", () => {
  it("stops on request and computes nothing afterwards", () => {
    const { emulator, clock, stops } = setup("uno-tick_probe.hex");
    emulator.start();
    clock.runUntil(50);
    emulator.stop();
    const stoppedAt = emulator.simTimeMs;
    clock.runUntil(200);

    expect(emulator.simTimeMs).toBe(stoppedAt);
    expect(stops).toEqual([{ reason: "stop", simTimeMs: stoppedAt, wallTimeMs: expect.any(Number) }]);
  });

  it("resets like the RESET button: the sketch restarts, time, EEPROM and outside levels go on", () => {
    const { emulator, clock, output } = setup("uno-tick_probe.hex");
    emulator.start();
    clock.runUntil(100);
    emulator.machine.eeprom[5] = 42;
    emulator.setDigital(2, 1);
    emulator.analog.setVolts(14, 2.2);
    emulator.reset();
    clock.runUntil(200);

    const lines = ticks(output());
    const restart = lines.findIndex(([n], i) => i > 0 && n === 0);
    expect(restart).toBeGreaterThan(5);
    expect(lines[restart][1]).toBeLessThan(2); // millis() starts again
    expect(emulator.simTimeMs).toBeGreaterThan(188);
    expect(emulator.machine.eeprom[5]).toBe(42);
    expect(emulator.pins.state(2).level).toBe(1);
    expect(emulator.analog.volts(14)).toBe(2.2);
  });

  it("refuses serial input while paused (PauseResume SSOT §10) and accepts it when running", () => {
    const { emulator } = setup("uno-tick_probe.hex");
    emulator.start();
    emulator.pause();
    expect(emulator.sendSerial(0, "x")).toBe(false);
    emulator.resume();
    expect(emulator.sendSerial(0, "x")).toBe(true);
    emulator.stop();
    expect(emulator.sendSerial(0, "x")).toBe(false);
  });

  it("runs headless to a simulated time and fires timed actions at their simulated time", () => {
    const { emulator, output } = setup("uno-tick_probe.hex");
    const fired: number[] = [];
    emulator.at(50, () => fired.push(emulator.simTimeMs));
    emulator.at(20, () => fired.push(emulator.simTimeMs));
    emulator.advance(100);

    expect(emulator.simTimeMs).toBeCloseTo(100, 3);
    expect(fired.map((t) => Math.round(t))).toEqual([20, 50]);
    expect(ticks(output()).length).toBeGreaterThanOrEqual(10);
    expect(emulator.state).toBe("idle");
  });

  it("reports an internal error as fault and stops", () => {
    const { emulator, clock, stops } = setup("uno-tick_probe.hex");
    emulator.at(10, () => {
      throw new Error("boom");
    });
    emulator.start();
    clock.runUntil(100);

    expect(emulator.state).toBe("stopped");
    expect(stops[0]).toMatchObject({ reason: "fault", error: "boom" });
  });

  it("rejects actions in the wrong state and invalid options", () => {
    const { emulator } = setup("uno-tick_probe.hex");
    expect(() => emulator.pause()).toThrow(/cannot pause while idle/);
    emulator.start();
    expect(() => emulator.start()).toThrow(/cannot start while running/);
    expect(() => emulator.advance(1)).toThrow(/cannot advance while running/);
    emulator.stop();
    expect(() => emulator.reset()).toThrow(/cannot reset while stopped/);
    expect(() => setup("uno-tick_probe.hex", { timeoutMs: 0 })).toThrow(/invalid timeout/);
  });
});

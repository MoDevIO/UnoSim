import { describe, expect, it } from "vitest";
import { PinModel } from "../src/index";
import { machineFromFixture, runWithEvents } from "./machine-helpers";

function probe() {
  const machine = machineFromFixture("uno", "uno-pin_probe.hex");
  return { machine, pins: new PinModel(machine) };
}

describe("PinModel", () => {
  it("starts with every digital pin as an open input reading LOW", () => {
    const { pins } = probe();

    expect(pins.snapshot()).toHaveLength(20);
    expect(pins.snapshot().every((p) => p.mode === "INPUT" && p.level === 0)).toBe(true);
    expect(pins.takeChanges()).toEqual({ changes: [], changeCount: 0 });
  });

  it("follows pinMode and digitalWrite: OUTPUT, INPUT and INPUT_PULLUP reading HIGH", () => {
    const { machine, pins } = probe();
    const serial = runWithEvents(machine, 5);

    expect(serial).toContain("D2=0 D3=1");
    expect(pins.state(13).mode).toBe("OUTPUT");
    expect(pins.state(2)).toEqual({ pin: 2, mode: "INPUT", level: 0 });
    expect(pins.state(3)).toEqual({ pin: 3, mode: "INPUT_PULLUP", level: 1 });
  });

  it("lets the sketch read levels set from outside, LOW on a pull-up input too", () => {
    const { machine, pins } = probe();
    const serial = runWithEvents(machine, 150, [
      [20, () => pins.setDigital(2, 1)],
      [60, () => pins.setDigital(3, 0)],
      [100, () => pins.setDigital(3, 1)],
    ]);

    expect(serial.split("\n").filter((l) => l.startsWith("D2="))).toEqual(["D2=0 D3=1", "D2=1 D3=1", "D2=1 D3=0", "D2=1 D3=1"]);
    expect(pins.state(3)).toEqual({ pin: 3, mode: "INPUT_PULLUP", level: 1 });
  });

  it("drops an outside level once the sketch makes the pin an OUTPUT, and ignores clicks on outputs", () => {
    const { machine, pins } = probe();
    let accepted: boolean | undefined;
    const serial = runWithEvents(machine, 350, [
      [20, () => pins.setDigital(2, 1)],
      [250, () => { accepted = pins.setDigital(2, 0); }],
    ]);

    expect(accepted).toBe(false);
    // 200 ms: OUTPUT HIGH; 300 ms: INPUT again, now open (the outside level is gone) and LOW.
    expect(serial.slice(serial.indexOf("D2 OUTPUT"))).toBe("D2 OUTPUT\nD2 INPUT\nD2=0 D3=1\n");
    expect(pins.state(2)).toEqual({ pin: 2, mode: "INPUT", level: 0 });
  });

  it("reports the last state per changed pin and counts every change", () => {
    const { machine, pins } = probe();
    runWithEvents(machine, 5);
    pins.takeChanges();
    runWithEvents(machine, 100); // pin 13 toggles every 10 ms

    const { changes, changeCount } = pins.takeChanges();
    expect(changes.map((c) => c.pin)).toEqual([13]);
    expect(changeCount).toBeGreaterThanOrEqual(9);
    expect(changeCount).toBeLessThanOrEqual(11);
    expect(changes[0]).toEqual(pins.state(13));
    expect(pins.takeChanges().changeCount).toBe(0);
  });

  it("rejects pins without a port bit and unknown pins", () => {
    const nano = machineFromFixture("nano", "nano-int_probe.hex");
    const pins = new PinModel(nano);

    expect(() => pins.setDigital(20, 1)).toThrow(/not a digital pin of nano/);
    expect(() => pins.state(42)).toThrow(RangeError);
    expect(pins.snapshot()).toHaveLength(20);
  });
});

describe("PinModel with an inconsistent machine", () => {
  it("names the missing port", () => {
    const machine = machineFromFixture("uno", "uno-int_probe.hex");
    const broken = { ...machine, peripherals: { ...machine.peripherals, ports: new Map() } };

    expect(() => new PinModel(broken)).toThrow(/atmega328p has no port D for D0/);
  });
});

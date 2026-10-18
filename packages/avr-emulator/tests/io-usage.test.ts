import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Emulator, type IoUsage, buildSimulationImage, loadSimulationImage } from "../src/index";
import { FakeClock } from "./fake-clock";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name));

/** Runs a fixture headless for `ms` and returns the sorted runtime findings. */
function findings(hexFile: string, { elfFile, ms = 60, stimulus }: { elfFile?: string; ms?: number; stimulus?: (e: Emulator) => void } = {}): IoUsage[] {
  const image = loadSimulationImage(
    buildSimulationImage({ board: "uno", hex: fixture(hexFile).toString("utf8"), ...(elfFile ? { elf: new Uint8Array(fixture(elfFile)) } : {}) }),
  );
  const emulator = new Emulator(image, { clock: new FakeClock(), timeoutMs: 10_000 });
  stimulus?.(emulator);
  emulator.advance(ms);
  return sorted(emulator.usage.snapshot());
}

const sorted = (usages: IoUsage[]) => [...usages].sort((a, b) => a.fn.localeCompare(b.fn) || a.pin - b.pin || (a.mode ?? "").localeCompare(b.mode ?? ""));

describe("IoUsageObserver, IoRegistry SSOT cases 1–11 (plan P1.9, spike P0.4 level R2)", () => {
  it("case 1: pinMode(13, OUTPUT)", () => {
    expect(findings("uno-ssot_tc01.hex")).toEqual([{ pin: 13, fn: "pinMode", mode: "OUTPUT" }]);
  });

  it("case 2: digitalRead(A0) is pin-exact", () => {
    expect(findings("uno-ssot_tc02.hex")).toEqual([{ pin: 14, fn: "digitalRead" }]);
  });

  it("case 3: digitalWrite in an array loop finds pins 2 and 3", () => {
    expect(findings("uno-ssot_tc03.hex")).toEqual([
      { pin: 2, fn: "digitalWrite" },
      { pin: 3, fn: "digitalWrite" },
    ]);
  });

  it("case 4: digitalWrite(led) with const int led = 12", () => {
    expect(findings("uno-ssot_tc04.hex")).toEqual([{ pin: 12, fn: "digitalWrite" }]);
  });

  it("case 5: pinMode(BTN, INPUT) with #define BTN A3", () => {
    expect(findings("uno-ssot_tc05.hex")).toEqual([{ pin: 17, fn: "pinMode", mode: "INPUT" }]);
  });

  it("case 6: digitalWrite(9) in loop() is reported once", () => {
    const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex: fixture("uno-ssot_tc06.hex").toString("utf8") }));
    const emulator = new Emulator(image, { clock: new FakeClock(), timeoutMs: 10_000 });
    emulator.advance(20);
    expect(emulator.usage.takeUsages()).toEqual([{ pin: 9, fn: "digitalWrite" }]);
    emulator.advance(100);
    expect(emulator.usage.takeUsages()).toEqual([]);
  });

  it("case 7: digitalRead(5) is pin-exact, digitalWrite(5, LOW) without level change is not reported", () => {
    expect(findings("uno-ssot_tc07.hex")).toEqual([{ pin: 5, fn: "digitalRead" }]);
  });

  it("case 7 with ELF symbols (no LTO): digitalWrite(5) is pin-exact too", () => {
    expect(findings("uno-ssot_tc07-nolto.hex", { elfFile: "uno-ssot_tc07-nolto.elf" })).toEqual([
      { pin: 5, fn: "digitalRead" },
      { pin: 5, fn: "digitalWrite" },
    ]);
  });

  it("case 8: digitalRead(random(0, 5)) resolves to the pin read", () => {
    expect(findings("uno-ssot_tc08.hex")).toEqual([{ pin: 4, fn: "digitalRead" }]);
  });

  it("case 9: pinMode(A0, INPUT) and digitalWrite(A0, HIGH) are both found, mode INPUT", () => {
    expect(findings("uno-ssot_tc09.hex")).toEqual([
      { pin: 14, fn: "digitalWrite" },
      { pin: 14, fn: "pinMode", mode: "INPUT" },
    ]);
  });

  it("case 10: digitalRead(pins[1]) finds pin 8", () => {
    expect(findings("uno-ssot_tc10.hex")).toEqual([{ pin: 8, fn: "digitalRead" }]);
  });

  it("case 11: pinMode(13) OUTPUT, then INPUT reports both modes", () => {
    expect(findings("uno-ssot_tc11.hex")).toEqual([
      { pin: 13, fn: "pinMode", mode: "INPUT" },
      { pin: 13, fn: "pinMode", mode: "OUTPUT" },
    ]);
  });
});

describe("IoUsageObserver, other functions", () => {
  it("finds analogRead by the ADMUX channel", () => {
    const result = findings("uno-adc_probe.hex", { ms: 200 });
    expect(result.filter((u) => u.fn === "analogRead").length).toBeGreaterThan(0);
    expect(result.every((u) => u.pin >= 14 || u.fn !== "analogRead")).toBe(true);
  });

  it("finds analogWrite(9, 128) as analogWrite only, not as its inner pinMode", () => {
    expect(findings("uno-io_analog_write.hex")).toEqual([{ pin: 9, fn: "analogWrite" }]);
  });

  it("treats analogWrite(0) and analogWrite(255) as digitalWrite, like the core (no level change stays port-exact, as case 7)", () => {
    expect(findings("uno-io_analog_edges.hex")).toEqual([
      { pin: 10, fn: "digitalWrite" },
      { pin: 10, fn: "pinMode", mode: "OUTPUT" },
      { pin: 11, fn: "pinMode", mode: "OUTPUT" },
    ]);
  });

  it("starts a new observer after a reset", () => {
    const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex: fixture("uno-ssot_tc01.hex").toString("utf8") }));
    const emulator = new Emulator(image, { clock: new FakeClock(), timeoutMs: 10_000 });
    emulator.advance(20);
    const before = emulator.usage;
    emulator.reset();
    expect(emulator.usage).not.toBe(before);
    emulator.advance(20);
    expect(emulator.usage.snapshot()).toEqual([{ pin: 13, fn: "pinMode", mode: "OUTPUT" }]);
  });
});

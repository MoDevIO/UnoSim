import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NANO, UNO, type BoardHardware } from "@unosim/avr-emulator";

/**
 * Plan P1.3: the board pin maps of the emulation core must match
 * pins_arduino.h of the pinned core. The core's preprocessor resolves the
 * tables (they sit behind #if blocks), the test compares them pin by pin.
 */
const work = mkdtempSync(join(tmpdir(), "unosim-pinmap-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Arduino.h of arduino:avr@1.8.8
const PORT_NUMBER: Readonly<Record<string, number>> = { B: 2, C: 3, D: 4 };
const TIMER_NUMBER: Readonly<Record<string, number>> = { "0A": 1, "0B": 2, "1A": 3, "1B": 4, "1C": 5, "2A": 7, "2B": 8 };

/** Runs the core's own preprocessor (paths from `arduino-cli --show-properties`) over pins_arduino.h. */
function preprocessedTables(fqbn: string): string {
  const sketch = join(work, `pinmap_${fqbn.replaceAll(/\W/g, "_")}`);
  mkdirSync(sketch, { recursive: true });
  writeFileSync(join(sketch, `${sketch.split("/").pop()}.ino`), "void setup() {}\nvoid loop() {}\n");
  const shown = spawnSync("arduino-cli", ["compile", "--fqbn", fqbn, "--show-properties", sketch], { encoding: "utf8", timeout: 120_000 });
  expect(shown.status, shown.stderr).toBe(0);
  const props = new Map(shown.stdout.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const prop = (key: string) => props.get(key) ?? "";

  const source = join(sketch, "tables.cpp");
  writeFileSync(source, [
    "#define ARDUINO_MAIN",
    "#include <Arduino.h>",
    "const int unosimNumAnalog = NUM_ANALOG_INPUTS;",
    "const int unosimLedBuiltin = LED_BUILTIN;",
  ].join("\n"));
  const result = spawnSync(`${prop("compiler.path")}${prop("compiler.cpp.cmd")}`, [
    "-E", "-P", `-mmcu=${prop("build.mcu")}`, `-DF_CPU=${prop("build.f_cpu")}`, `-DARDUINO=${prop("runtime.ide.version")}`,
    `-DARDUINO_${prop("build.board")}`, `-DARDUINO_ARCH_${prop("build.arch")}`,
    `-I${prop("build.core.path")}`, `-I${prop("build.variant.path")}`, source,
  ], { encoding: "utf8", timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function table(source: string, name: string): number[] {
  const body = new RegExp(String.raw`${name}\[\]\s*=\s*\{([^}]*)\}`).exec(source)?.[1];
  expect(body, name).toBeDefined();
  return (body ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const shift = /^\(1(?:UL?)? << \((\d+)\)\)$/.exec(entry);
    return shift ? 1 << Number(shift[1]) : Number(entry);
  });
}

const scalar = (source: string, name: string) => Number(new RegExp(String.raw`${name} = \(?(\d+)\)?;`).exec(source)?.[1]);

describe.each([
  ["arduino:avr:uno", UNO],
  ["arduino:avr:nano:cpu=atmega328", NANO],
] as Array<[string, BoardHardware]>)("pin map of %s", (fqbn, board) => {
  const source = preprocessedTables(fqbn);
  const ports = table(source, "digital_pin_to_port_PGM");
  const masks = table(source, "digital_pin_to_bit_mask_PGM");
  const timers = table(source, "digital_pin_to_timer_PGM");

  it("has the same digital pins with port, bit and timer", () => {
    const withPort = board.pins.filter((pin) => pin.port);
    expect(withPort.map((pin) => pin.pin)).toEqual(ports.map((_, index) => index));
    for (const pin of withPort) {
      expect([ports[pin.pin], masks[pin.pin]], pin.label).toEqual([PORT_NUMBER[pin.port?.port ?? ""], 1 << (pin.port?.bit ?? 0)]);
      const timer = pin.pwm ? TIMER_NUMBER[`${pin.pwm.timer}${pin.pwm.channel}`] : 0;
      expect(timers[pin.pin], `${pin.label} timer`).toBe(timer);
    }
  });

  it("has the same analog inputs, A-pin numbers and LED_BUILTIN", () => {
    const analog = board.pins.filter((pin) => pin.adcChannel !== undefined);
    expect(analog).toHaveLength(scalar(source, "unosimNumAnalog"));
    for (const pin of analog) expect(scalar(source, `A${pin.adcChannel}`), pin.label).toBe(pin.pin);
    expect(board.ledBuiltin).toBe(scalar(source, "unosimLedBuiltin"));
  });
});

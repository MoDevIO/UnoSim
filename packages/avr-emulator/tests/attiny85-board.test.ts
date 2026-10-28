import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTINY85, ATTINY85_BOARD, Emulator, boardHardware, buildSimulationImage, hasBoardHardware, loadSimulationImage, mcuProfile } from "../src/index";
import { FakeClock } from "./fake-clock";

function emulator(fixture: string): Emulator {
  const hex = readFileSync(join(__dirname, "fixtures", `attiny85-${fixture}.hex`), "utf8");
  return new Emulator(loadSimulationImage(buildSimulationImage({ board: "attiny85", hex })), { clock: new FakeClock(), timeoutMs: 60_000 });
}

const text = (e: Emulator) => e.takeSerialOutput().map((output) => output.text).join("").replaceAll("\r\n", "\n");

/** Advances in 25 ms steps until `done` holds or `maxMs` passed (emulation is costly under coverage). */
function advanceUntil(e: Emulator, done: () => boolean, maxMs: number): void {
  for (let ms = 0; ms < maxMs && !done(); ms += 25) e.advance(25);
}

describe("board hardware ATtiny85 (plan P6.4)", () => {
  it("is registered with its MCU profile", () => {
    expect(hasBoardHardware("attiny85")).toBe(true);
    expect(boardHardware("attiny85")).toBe(ATTINY85_BOARD);
    expect(mcuProfile("attiny85")).toBe(ATTINY85);
    expect(ATTINY85_BOARD).toMatchObject({ mcu: "attiny85", clockHz: 8_000_000, vccVolts: 5, ledBuiltin: 1 });
  });

  it("numbers the pins 0–5 as PB0–PB5 with A0–A3 as second names of 5, 2, 4, 3", () => {
    expect(ATTINY85_BOARD.pins.map((p) => [p.pin, p.label, p.port?.bit, p.analogName ?? "", p.adcChannel ?? -1])).toEqual([
      [0, "PB0", 0, "", -1],
      [1, "PB1", 1, "", -1],
      [2, "PB2", 2, "A1", 1],
      [3, "PB3", 3, "A3", 3],
      [4, "PB4", 4, "A2", 2],
      [5, "PB5", 5, "A0", 0],
    ]);
  });

  it("has PWM on 0 (timer 0 A), 1 (timer 1 A) and 4 (timer 1 B), RESET on 5 and Serial on 0/1", () => {
    expect(ATTINY85_BOARD.pins.filter((p) => p.pwm).map((p) => `${p.pin}:${p.pwm?.timer}${p.pwm?.channel}`)).toEqual(["0:0A", "1:1A", "4:1B"]);
    expect(ATTINY85_BOARD.pins.find((p) => p.pin === 5)?.role).toBe("reset");
    expect(ATTINY85_BOARD.pins.filter((p) => p.role === "serial").map((p) => p.pin)).toEqual([0, 1]);
    expect(ATTINY85_BOARD.serialPorts).toEqual([{ index: 0, kind: "software", rxPin: 1, txPin: 0 }]);
  });
});

describe("ATtiny85 in the emulator", () => {
  it("prints Serial through the software UART as port 0", () => {
    const e = emulator("tiny_serial");
    e.setAnalog(2, 512); // A1
    e.setAnalog(3, 102); // A3: 0.5 V
    let output = "";
    const take = () => e.takeSerialOutput().map((chunk) => chunk.text).join("");
    advanceUntil(e, () => (output += take()).includes("DONE"), 1500);
    const lines = output.replaceAll("\r\n", "\n").split("\n");
    expect(lines[0]).toBe("int 32767 + 1 = -32768");
    expect(lines).toContain("A1 VCC = 512");
    expect(lines).toContain("DONE");
    expect(e.serial.frameConfig(0)).toEqual({ baud: 9600, dataBits: 8, parity: "none", stopBits: 1 });
  });

  it("receives Serial input after Serial.begin() and answers", () => {
    const e = emulator("tiny_echo");
    e.advance(200);
    expect(text(e)).toBe("ready\n");
    // Without a line ending: a "\n" would stay in the buffer and the next parseInt() return 0, as on the board.
    expect(e.sendSerial(0, "21")).toBe(true);
    e.advance(1500);
    expect(text(e)).toBe("got 21\ntwice 42\n");
  });

  it("decodes with the Serial Monitor's baud rate until the line reveals the sketch's", () => {
    const e = emulator("tiny_serial_ff");
    e.serial.setFallbackBaud(0, 9600);
    e.advance(100);
    // The byte arrives; 0xFF is never valid UTF-8, so the decoder shows U+FFFD.
    expect(e.takeSerialOutput()).toEqual([{ port: 0, text: "\ufffd" }]);
    expect(e.serial.frameConfig(0).baud).toBe(9600);
  });

  describe("tiny_probe", () => {
    const e = emulator("tiny_probe");
    e.setAnalog(2, 512);
    // The probe writes its results to EEPROM and ends with the two analogWrite calls after the marker.
    advanceUntil(e, () => e.machine.peripherals.adc.channelValues.length > 0 && e.pins.state(0).pwm !== undefined, 1000);

    it("shows the analogWrite duty cycles of timer 1 (PB4) and timer 0 (PB0)", () => {
    expect(e.pins.state(4)).toMatchObject({ mode: "OUTPUT", pwm: 200, level: 1 });
    expect(e.pins.state(0)).toMatchObject({ mode: "OUTPUT", pwm: 77, level: 0 });
    expect(e.usage.snapshot().filter((usage) => usage.fn === "analogWrite").map((usage) => usage.pin).sort()).toEqual([0, 4]);
    });

    it("reads analog inputs by their pin number", () => {
    expect(e.machine.peripherals.adc.channelValues[1]).toBeCloseTo((512.5 / 1024) * 5, 3);
    });
  });
});

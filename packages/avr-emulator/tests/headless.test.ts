import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, type HeadlessOptions, buildSimulationImage, formatReport, loadSimulationImage, parseStimuli, runCli, runHeadless } from "../src/index";

const fixtureText = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const run = (name: string, options: HeadlessOptions) =>
  runHeadless(loadSimulationImage(buildSimulationImage({ board: "uno", hex: fixtureText(name) })), options);

describe("runHeadless (plan P1.13)", () => {
  it("applies stimuli at their simulated times", () => {
    const result = run("uno-tick_probe.hex", { simMs: 60, events: [[20, "pin", 2, 1]] });

    expect(result.serial.get(0)).toMatch(/^0 0\r\n1 10\r\n2 20\r\n/);
    expect(result.simTimeMs).toBeGreaterThanOrEqual(60);
    expect(result.pins.find((p) => p.pin === 2)).toMatchObject({ mode: "INPUT", level: 1 });
    expect(result.speed).toBeGreaterThan(0);
  });

  it("delivers serial input and ADC voltages (prototype name `adc` included)", () => {
    const result = run("uno-adc_probe.hex", {
      simMs: 30,
      events: [[0, "adc", 5, 2.5], [0, "adcVolts", 0, 5]],
    });

    expect(result.serial.get(0)).toContain("A0 1023");
    expect(result.serial.get(0)).toContain("A5 512");
    const echo = run("uno-serial_probe.hex", { simMs: 60, events: [[10, "serial", "42\n"]] });
    expect(echo.serial.get(0)).toMatch(/n=42 after \d+ ms/);
  });

  it("evaluates pin, PWM and ADC state checks after the stimuli of the same time", () => {
    const pins = run("uno-ssot_tc01.hex", { simMs: 10, expectState: [[5, "pin", 13, "OUTPUT", 0], [5, "pin", 13, "OUTPUT", 1]] });
    const pwm = run("uno-io_analog_write.hex", { simMs: 10, expectState: [[8, "pwm", 9, 128], [8, "pwm", 3, 0]] });
    const adc = run("uno-adc_probe.hex", {
      simMs: 30,
      events: [[0, "adcVolts", 5, 2.5]],
      expectState: [[22, "adcRaw", 5, 512], [26, "adcRaw", 5, 512]],
    });

    expect(pins.checks.map((c) => [c.ok, c.actual])).toEqual([[true, "OUTPUT 0"], [false, "OUTPUT 0"]]);
    expect(pwm.checks.map((c) => [c.ok, c.actual])).toEqual([[true, "128"], [false, "no PWM"]]);
    expect(adc.checks.map((c) => [c.ok, c.actual])).toEqual([[true, "512"], [false, "channel 0 selected"]]);
  });

  it("fires an action at exactly the end of the run", () => {
    const result = run("uno-ssot_tc01.hex", { simMs: 10, expectState: [[10, "pin", 13, "OUTPUT", 0]] });

    expect(result.checks).toHaveLength(1);
  });

  it("collects usage and diagnostics of the run", () => {
    expect(run("uno-ssot_tc01.hex", { simMs: 20 }).usages).toEqual([{ pin: 13, fn: "pinMode", mode: "OUTPUT" }]);
    expect(run("uno-diag_sleep_cli.hex", { simMs: 20 }).diagnostics.map((d) => d.kind)).toEqual(["sleep-interrupts-disabled"]);
  });

  it("runs zero time and long times in chunks", () => {
    expect(run("uno-tick_probe.hex", { simMs: 0, expectState: [[0, "pin", 13, "INPUT", 0]] }).checks).toHaveLength(1);
    const chunked = run("uno-serial_probe.hex", { simMs: 25, chunkMs: 10 });
    const whole = run("uno-serial_probe.hex", { simMs: 25 });

    expect(chunked.simTimeMs).toBeGreaterThanOrEqual(25);
    expect(chunked.serial.get(0)).toBe(whole.serial.get(0));
    expect(() => run("uno-tick_probe.hex", { simMs: 5, chunkMs: 0 })).toThrow(RangeError);
  });

  it("starts from a given EEPROM content", () => {
    const eeprom = new Uint8Array(1024).fill(7);

    expect(run("uno-tick_probe.hex", { simMs: 1, eeprom }).eeprom[0]).toBe(7);
  });

  it.each<[string, HeadlessOptions]>([
    ["a negative duration", { simMs: -1 }],
    ["an unknown stimulus", { simMs: 1, events: [[0, "wiggle", 1] as never] }],
    ["an ADC channel the board lacks", { simMs: 5, events: [[0, "adcVolts", 9, 1]] }],
    ["a stimulus with a wrong argument", { simMs: 1, events: [[0, "pin", "two", 1] as never] }],
  ])("refuses %s", (_name, options) => {
    expect(() => run("uno-tick_probe.hex", options)).toThrow(RangeError);
  });
});

describe("parseStimuli", () => {
  it.each<[string, unknown, RegExp]>([
    ["a non-array", {}, /must be an array/],
    ["an entry without time", [["serial", "x"]], /time in ms and a kind/],
    ["a negative time", [[-1, "serial", "x"]], /time in ms/],
    ["an unknown kind", [[0, "led", 1]], /unknown kind "led"/],
    ["a missing argument", [[0, "pin", 2]], /argument 2 of "pin"/],
  ])("rejects %s", (_name, value, message) => {
    expect(() => parseStimuli(value, "events")).toThrow(message);
  });

  it("accepts an optional serial port", () => {
    expect(() => parseStimuli([[0, "serial", "x"], [1, "serial", "y", 1]], "events")).not.toThrow();
  });

  it("checks expectations with their own kinds", () => {
    expect(() => parseStimuli([[0, "pin", 13, "OUTPUT", 1]], "expectState")).not.toThrow();
    expect(() => parseStimuli([[0, "serial", "x"]], "expectState")).toThrow(/unknown kind/);
  });
});

function fakeIo(files: Record<string, string | Uint8Array>) {
  const out: string[] = [];
  const io: CliIo = {
    readText(path) {
      const file = files[path];
      if (typeof file !== "string") throw new Error(`no such file ${path}`);
      return file;
    },
    readBytes(path) {
      const file = files[path];
      if (!(file instanceof Uint8Array)) throw new Error(`no such file ${path}`);
      return file;
    },
    write: (text) => out.push(text),
  };
  return { io, output: () => out.join("") };
}

describe("runCli", () => {
  const files = {
    "tick.hex": fixtureText("uno-tick_probe.hex"),
    "tc07.hex": fixtureText("uno-ssot_tc07-nolto.hex"),
    "tc07.elf": new Uint8Array(readFileSync(join(__dirname, "fixtures", "uno-ssot_tc07-nolto.elf"))),
    "ok.json": JSON.stringify({ board: "uno", simMs: 30, events: [[10, "pin", 2, 1]], expectState: [[20, "pin", 2, "INPUT", 1]] }),
    "bad.json": JSON.stringify({ simMs: 30, events: [[10, "pin", 2, 1]], expectState: [[20, "pin", 2, "INPUT", 0]] }),
  };

  it("prints serial text, pins, usage and the speed", () => {
    const { io, output } = fakeIo(files);

    const code = runCli(["tick.hex", "--ms", "35", "--events", '[[5,"pin",2,1]]'], io);

    expect(code).toBe(0);
    expect(output()).toContain("--- serial port 0 ---\n0 0\n1 10\n2 20\n3 30");
    expect(output()).toContain("pin 2: INPUT 1");
    expect(output()).toMatch(/35 ms simulated, speed [\d.]+x real time \(1 run, median\)/);
  });

  it("reads a case file and returns 1 when a state check fails", () => {
    const passing = fakeIo(files);
    const failing = fakeIo(files);

    expect(runCli(["tick.hex", "--case", "ok.json"], passing.io)).toBe(0);
    expect(passing.output()).toContain("ok   [20,\"pin\",2,\"INPUT\",1]");
    expect(runCli(["tick.hex", "--case", "bad.json"], failing.io)).toBe(1);
    expect(failing.output()).toContain("FAIL [20,\"pin\",2,\"INPUT\",0] (actual: INPUT 1)");
  });

  it("uses ELF symbols and reports I/O usage and diagnostics", () => {
    const { io, output } = fakeIo(files);

    runCli(["tc07.hex", "--elf", "tc07.elf", "--ms", "30"], io);

    expect(output()).toContain("digitalRead(5)");
    expect(output()).toContain("digitalWrite(5)");
  });

  it("prints JSON and the median over repeated runs", () => {
    const { io, output } = fakeIo(files);

    expect(runCli(["tick.hex", "--ms", "20", "--repeat", "3", "--json"], io)).toBe(0);

    const json = JSON.parse(output());
    expect(json).toMatchObject({ runs: 3, serial: { 0: expect.stringContaining("1 10") }, checks: [] });
    expect(json.speed).toBeGreaterThan(0);
  });

  it.each([
    ["no file", [], /Usage/],
    ["--help", ["--help"], /Usage/],
    ["two files", ["a.hex", "b.hex"], /Usage/],
    ["an option without value", ["tick.hex", "--ms"], /--ms needs a value/],
    ["an unknown board", ["tick.hex", "--board", "esp32"], /unknown board "esp32"/],
    ["a bad duration", ["tick.hex", "--ms", "-5"], /--ms must be/],
    ["a bad repeat count", ["tick.hex", "--repeat", "0"], /--repeat must be/],
    ["a missing file", ["nothing.hex"], /no such file nothing.hex/],
    ["invalid events", ["tick.hex", "--events", '[[0,"led",1]]'], /unknown kind/],
  ])("exits with 2 for %s", (_name, args, message) => {
    const { io, output } = fakeIo(files);

    expect(runCli(args, io)).toBe(2);
    expect(output()).toMatch(message);
  });
});

describe("formatReport", () => {
  it("lists diagnostics and keeps the report readable without output", () => {
    const result = run("uno-diag_sleep_cli.hex", { simMs: 20 });

    const report = formatReport(result);

    expect(report).toContain("--- diagnostics ---");
    expect(report).toContain("sleep-interrupts-disabled");
    expect(report).not.toContain("--- serial port");
  });
});

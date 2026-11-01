import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSimulationImage, loadSimulationImage, runHeadless } from "../../packages/avr-emulator/src/index";
import { ArduinoCompiler } from "../../server/services/arduino-compiler";
import { getBoard } from "../../shared/boards";

/** The ten general built-in examples on the Uno, with the stimuli their "Beobachtung" comments name. */
const CASES: readonly { name: string; simMs: number; events?: unknown[]; expectState?: unknown[]; output?: string[] }[] = [
  { name: "01-blink", simMs: 1200, expectState: [[250, "pin", 13, "OUTPUT", 1], [750, "pin", 13, "OUTPUT", 0], [1100, "pin", 13, "OUTPUT", 1]] },
  { name: "02-digital-input", simMs: 1200, events: [[250, "pin", 2, 0], [750, "pin", 2, 1]], output: ["released", "pressed", "released"] },
  { name: "03-digital-io", simMs: 300, events: [[100, "pin", 2, 0], [200, "pin", 2, 1]], expectState: [[50, "pin", 13, "OUTPUT", 0], [150, "pin", 13, "OUTPUT", 1], [250, "pin", 13, "OUTPUT", 0]] },
  { name: "04-analog-input", simMs: 350, events: [[0, "adcVolts", 0, 2.5]], output: ["A0: 512", "A0: 512"] },
  { name: "05-pwm-output", simMs: 250, expectState: [[210, "pwm", 9, 50]] },
  { name: "07-serial-plotter", simMs: 1050, output: Array.from({ length: 11 }, (_, index) => `value:${index * 10}`) },
  { name: "08-multiple-io", simMs: 650, events: [[0, "adcVolts", 0, 2.5], [300, "pin", 2, 0]], output: ["sensor=512 pwm=127", "sensor=512 pwm=127", "sensor=512 pwm=128"] },
  { name: "09-nonblocking-timing", simMs: 1100, output: ["tick", "tock"], expectState: [[600, "pin", 13, "OUTPUT", 1], [1050, "pin", 13, "OUTPUT", 0]] },
  { name: "10-unosim-showcase", simMs: 1100, events: [[0, "adcVolts", 0, 2.5], [700, "pin", 2, 0]] },
];

describe("built-in examples on the Uno + browser emulation (real toolchain)", () => {
  let compiler: ArduinoCompiler;
  let root: string;

  beforeAll(async () => {
    compiler = new ArduinoCompiler();
    root = await mkdtemp(join(tmpdir(), "unosim-builtin-it-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function run(name: string, options: { simMs: number; events?: unknown[]; expectState?: unknown[] }) {
    const code = readFileSync(resolve(__dirname, `../../public/examples/${name}.ino`), "utf8");
    const result = await compiler.compile(`// ${randomUUID()}\n${code}`, undefined, undefined, {
      board: "uno",
      fqbn: getBoard("uno").fqbn,
      buildPath: join(root, randomUUID()),
      hexCacheDir: join(root, "hex-cache"),
    });
    expect(result.errors).toEqual([]);
    const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex: result.binary!.toString("utf8") }));
    return runHeadless(image, options as Parameters<typeof runHeadless>[1]);
  }

  it.each(CASES)("$name behaves as its comment says", async ({ name, output, ...options }) => {
    const result = await run(name, options);

    expect(result.diagnostics).toEqual([]);
    expect(result.checks.filter((check) => !check.ok)).toEqual([]);
    expect(result.checks).toHaveLength(options.expectState?.length ?? 0);
    if (output) expect((result.serial.get(0) ?? "").split(/\r?\n/).filter(Boolean)).toEqual(output);
  });

  it("06-serial-monitor greets once and reports millis every second", async () => {
    const lines = ((await run("06-serial-monitor", { simMs: 2100 })).serial.get(0) ?? "").split(/\r?\n/).filter(Boolean);

    expect(lines[0]).toBe("UnoSim serial monitor demo");
    expect(lines.slice(1)).toHaveLength(3);
  });
});

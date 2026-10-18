import { afterEach, describe, expect, it, vi } from "vitest";
import { Emulator, ImageError, buildSimulationImage, decodeBase64, loadFlashImage, loadSimulationImage, sha256Hex } from "../src/index";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeClock } from "./fake-clock";

const hex = readFileSync(join(__dirname, "fixtures", "uno-blink.hex"), "utf8");

describe("loadFlashImage (worker load, plan P1.12)", () => {
  const image = buildSimulationImage({ board: "uno", hex });
  const bytes = decodeBase64(image.flashBase64);

  it("expands transferred flash like the base64 path", () => {
    const loaded = loadFlashImage("uno", bytes, image.sha256, image.symbols);

    expect(loaded).toEqual(loadSimulationImage(image));
  });

  it.each([
    ["empty flash", new Uint8Array(0), sha256Hex(new Uint8Array(0)), /empty/],
    ["flash above the MCU size", new Uint8Array(0x8001), sha256Hex(new Uint8Array(0x8001)), /exceeds/],
    ["a wrong SHA-256", bytes, "0".repeat(64), /SHA-256/],
  ])("refuses %s", (_name, flash, sha256, message) => {
    expect(() => loadFlashImage("uno", flash, sha256, {})).toThrow(ImageError);
    expect(() => loadFlashImage("uno", flash, sha256, {})).toThrow(message);
  });

  it("drops symbols that are out of range", () => {
    const loaded = loadFlashImage("uno", bytes, image.sha256, { functions: { pinMode: 1 << 20 }, data: { __bss_end: 0x200 } });

    expect(loaded.symbols).toEqual({ functions: {}, data: { __bss_end: 0x200 } });
  });
});

describe("Emulator.configureTimeout", () => {
  const loaded = loadSimulationImage(buildSimulationImage({ board: "uno", hex }));

  it("sets the timeout while idle and refuses invalid values and later changes", () => {
    const emulator = new Emulator(loaded, { clock: new FakeClock(), timeoutMs: 1000 });

    emulator.configureTimeout(5000);
    expect(() => emulator.configureTimeout(0)).toThrow(RangeError);
    emulator.start();
    expect(() => emulator.configureTimeout(1000)).toThrow(/while running/);
  });
});

describe("worker entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("installs the host on the global scope", async () => {
    const listeners: Array<(event: { data: unknown }) => void> = [];
    vi.stubGlobal("addEventListener", (_type: string, listener: (event: { data: unknown }) => void) => listeners.push(listener));
    vi.stubGlobal("postMessage", vi.fn());

    await import("../src/worker/entry");

    expect(listeners).toHaveLength(1);
  });
});

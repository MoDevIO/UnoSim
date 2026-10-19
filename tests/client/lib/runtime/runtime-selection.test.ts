import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENGINE_LABELS, ENGINE_PREFERENCE_EVENT, ENGINE_PREFERENCE_KEY, isRuntimeKind, readEnginePreference, selectRuntime, storeEnginePreference, usableRuntimes,
} from "../../../../client/src/lib/runtime/runtime-selection";

const both = ["browser", "host-mock"] as const;

describe("selectRuntime (plan P3.1)", () => {
  it("takes the user's choice when the server offers it and the board supports it", () => {
    expect(selectRuntime({ offered: both, boardRuntimes: both, userChoice: "browser", serverDefault: "host-mock" })).toBe("browser");
    expect(selectRuntime({ offered: both, boardRuntimes: both, userChoice: "host-mock", serverDefault: "browser" })).toBe("host-mock");
  });

  it("takes the server default without a choice", () => {
    expect(selectRuntime({ offered: both, boardRuntimes: both, serverDefault: "host-mock" })).toBe("host-mock");
  });

  it("ignores a choice the server does not offer", () => {
    expect(selectRuntime({ offered: ["host-mock"], boardRuntimes: both, userChoice: "browser", serverDefault: "host-mock" })).toBe("host-mock");
  });

  it("ignores a choice the board does not support", () => {
    expect(selectRuntime({ offered: both, boardRuntimes: ["browser"], userChoice: "host-mock", serverDefault: "host-mock" })).toBe("browser");
  });

  it("falls back to the first usable runtime when the server default is not usable", () => {
    expect(selectRuntime({ offered: ["host-mock", "browser"], boardRuntimes: ["browser"], serverDefault: "host-mock" })).toBe("browser");
  });

  it("is undefined when nothing is both offered and supported", () => {
    expect(selectRuntime({ offered: ["host-mock"], boardRuntimes: ["browser"], serverDefault: "host-mock" })).toBeUndefined();
    expect(selectRuntime({ offered: [], boardRuntimes: both, serverDefault: "browser" })).toBeUndefined();
  });

  it("lists usable runtimes in the server's order", () => {
    expect(usableRuntimes({ offered: ["host-mock", "browser"], boardRuntimes: ["browser", "host-mock"] })).toEqual(["host-mock", "browser"]);
  });

  it("names the engines for the settings dialog", () => {
    expect(ENGINE_LABELS).toEqual({ browser: "Emulation", "host-mock": "Legacy" });
    expect(isRuntimeKind("browser")).toBe(true);
    expect(isRuntimeKind("native")).toBe(false);
    expect(isRuntimeKind(undefined)).toBe(false);
  });
});

describe("engine preference", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips through storage and announces the change", () => {
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail.value);
    document.addEventListener(ENGINE_PREFERENCE_EVENT, listener);

    storeEnginePreference("browser");
    expect(localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBe("browser");
    expect(readEnginePreference()).toBe("browser");
    storeEnginePreference(undefined);
    expect(localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBeNull();
    expect(readEnginePreference()).toBeUndefined();

    document.removeEventListener(ENGINE_PREFERENCE_EVENT, listener);
    expect(seen).toEqual(["browser", null]);
  });

  it("treats an unknown stored value as no choice", () => {
    localStorage.setItem(ENGINE_PREFERENCE_KEY, "wasm");

    expect(readEnginePreference()).toBeUndefined();
  });

  it("survives unreadable and unwritable storage", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };

    expect(readEnginePreference(broken)).toBeUndefined();
    expect(() => storeEnginePreference("browser", broken)).not.toThrow();
    expect(() => storeEnginePreference(undefined, broken)).not.toThrow();
    expect(readEnginePreference(undefined)).toBeUndefined();
  });
});

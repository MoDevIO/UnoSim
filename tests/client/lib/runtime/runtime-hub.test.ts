import { describe, expect, it, vi } from "vitest";
import { RuntimeHub } from "../../../../client/src/lib/runtime/runtime-hub";
import type { AnyRuntimeEvent, SimulationRuntime } from "../../../../client/src/lib/runtime/simulation-runtime";

function fakeRuntime(kind: "browser" | "host-mock") {
  let listener: (event: AnyRuntimeEvent) => void = () => undefined;
  const runtime = {
    kind,
    dispose: vi.fn(),
    subscribe: vi.fn((next: (event: AnyRuntimeEvent) => void) => { listener = next; return () => undefined; }),
  } as unknown as SimulationRuntime;
  return { runtime, emit: (event: AnyRuntimeEvent) => listener(event) };
}

function setup() {
  const browser = fakeRuntime("browser");
  const hostMock = fakeRuntime("host-mock");
  const delivered: AnyRuntimeEvent[] = [];
  const hub = new RuntimeHub({ createBrowser: async () => browser.runtime, createHostMock: () => hostMock.runtime, deliver: (message) => delivered.push(message) });
  return { hub, browser, hostMock, delivered };
}

describe("RuntimeHub (plan P3.4)", () => {
  it("creates each runtime once, on first use; the browser runtime loads on demand", async () => {
    const { hub, browser, hostMock } = setup();

    expect(hub.peek("browser")).toBeUndefined();
    const [first, second] = await Promise.all([hub.load("browser"), hub.load("browser")]);
    expect(first).toBe(browser.runtime);
    expect(second).toBe(browser.runtime);
    expect(await hub.load("browser")).toBe(browser.runtime);
    expect(hub.peek("browser")).toBe(browser.runtime);
    expect(browser.runtime.subscribe).toHaveBeenCalledTimes(1);
    expect(hub.peek("host-mock")).toBe(hostMock.runtime);
    expect(await hub.load("host-mock")).toBe(hostMock.runtime);
  });

  it("remembers the runtime of the current run", () => {
    const { hub } = setup();

    expect(hub.active).toBeUndefined();
    hub.setActive("browser");
    expect(hub.active).toBe("browser");
  });

  it("delivers the browser runtime's server-style events into the message stream and its own events to listeners", async () => {
    const { hub, browser, delivered } = setup();
    const own: AnyRuntimeEvent[] = [];
    hub.onBrowserEvent((event) => own.push(event));
    await hub.load("browser");

    browser.emit({ type: "serial_output", data: "hi" });
    browser.emit({ type: "runtime_usage", usages: [] });

    expect(delivered).toEqual([{ type: "serial_output", data: "hi" }]);
    expect(own).toEqual([{ type: "runtime_usage", usages: [] }]);
  });

  it("does not deliver the host mock's events again: they already come through the connection", () => {
    const { hub, hostMock, delivered } = setup();
    hub.peek("host-mock");

    expect(hostMock.runtime.subscribe).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
  });

  it("stops notifying an unsubscribed listener and disposes all runtimes", async () => {
    const { hub, browser, hostMock } = setup();
    const own: AnyRuntimeEvent[] = [];
    const off = hub.onBrowserEvent((event) => own.push(event));
    await hub.load("browser");
    hub.peek("host-mock");
    off();
    browser.emit({ type: "runtime_usage", usages: [] });

    hub.dispose();

    expect(own).toEqual([]);
    expect(browser.runtime.dispose).toHaveBeenCalled();
    expect(hostMock.runtime.dispose).toHaveBeenCalled();
  });
});

describe("RuntimeHub browser run state (plan P3.5)", () => {
  it("tracks a browser run from its start until the browser runtime reports it stopped, and notifies", async () => {
    const { hub, browser } = setup();
    await hub.load("browser");
    const changes: boolean[] = [];
    hub.onChange(() => changes.push(hub.browserRunActive));

    hub.setActive("browser");
    expect(hub.browserRunActive).toBe(true);
    browser.emit({ type: "simulation_status", status: "running" });
    expect(hub.browserRunActive).toBe(true);
    browser.emit({ type: "simulation_status", status: "stopped" });

    expect(hub.browserRunActive).toBe(false);
    expect(hub.active).toBe("browser"); // the runtime of the latest run
    expect(changes).toEqual([true, false]);
  });

  it("does not count a host-mock run as a browser run, and ignores a stop of the browser runtime during one", async () => {
    const { hub, browser } = setup();
    await hub.load("browser");

    hub.setActive("host-mock");
    browser.emit({ type: "simulation_status", status: "stopped" });

    expect(hub.browserRunActive).toBe(false);
  });

  it("stops notifying an unsubscribed listener", () => {
    const { hub } = setup();
    const listener = vi.fn();
    hub.onChange(listener)();

    hub.setActive("browser");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("RuntimeHub message origin", () => {
  it("tells the run events of a browser run from the server's messages", () => {
    const { hub } = setup();

    expect(hub.isBrowserEvent({ type: "serial_output" })).toBe(false); // no browser run yet
    hub.setActive("browser");

    expect(["serial_output", "simulation_status", "pin_state_batch", "io_registry"].map((type) => hub.isBrowserEvent({ type }))).toEqual([true, true, true, true]);
    expect(hub.isBrowserEvent({ type: "compilation_status" })).toBe(false); // the server still reports compiles
    hub.setActive("host-mock");
    expect(hub.isBrowserEvent({ type: "serial_output" })).toBe(false);
  });
});

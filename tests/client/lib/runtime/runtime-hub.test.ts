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

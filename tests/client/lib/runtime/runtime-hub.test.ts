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
  const hub = new RuntimeHub({ createBrowser: () => browser.runtime, createHostMock: () => hostMock.runtime, deliver: (message) => delivered.push(message) });
  return { hub, browser, hostMock, delivered };
}

describe("RuntimeHub (plan P3.4)", () => {
  it("creates each runtime once, on first use", () => {
    const { hub, browser, hostMock } = setup();

    expect(hub.get("browser")).toBe(browser.runtime);
    expect(hub.get("browser")).toBe(browser.runtime);
    expect(browser.runtime.subscribe).toHaveBeenCalledTimes(1);
    expect(hub.get("host-mock")).toBe(hostMock.runtime);
  });

  it("delivers the browser runtime's server-style events into the message stream and its own events to listeners", () => {
    const { hub, browser, delivered } = setup();
    const own: AnyRuntimeEvent[] = [];
    hub.onBrowserEvent((event) => own.push(event));
    hub.get("browser");

    browser.emit({ type: "serial_output", data: "hi" });
    browser.emit({ type: "runtime_usage", usages: [] });

    expect(delivered).toEqual([{ type: "serial_output", data: "hi" }]);
    expect(own).toEqual([{ type: "runtime_usage", usages: [] }]);
  });

  it("does not deliver the host mock's events again: they already come through the connection", () => {
    const { hub, hostMock, delivered } = setup();
    hub.get("host-mock");

    expect(hostMock.runtime.subscribe).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
  });

  it("stops notifying an unsubscribed listener and disposes all runtimes", () => {
    const { hub, browser, hostMock } = setup();
    const own: AnyRuntimeEvent[] = [];
    const off = hub.onBrowserEvent((event) => own.push(event));
    hub.get("browser");
    hub.get("host-mock");
    off();
    browser.emit({ type: "runtime_usage", usages: [] });

    hub.dispose();

    expect(own).toEqual([]);
    expect(browser.runtime.dispose).toHaveBeenCalled();
    expect(hostMock.runtime.dispose).toHaveBeenCalled();
  });
});

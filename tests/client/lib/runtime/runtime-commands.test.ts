import { describe, expect, it, vi } from "vitest";
import type { WSMessage } from "@shared/schema";
import { createRuntimeCommandRouter } from "../../../../client/src/lib/runtime/runtime-commands";
import type { RuntimeHub } from "../../../../client/src/lib/runtime/runtime-hub";

function setup(active: "browser" | "host-mock" | undefined) {
  const runtime = { pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), sendSerial: vi.fn(), setPin: vi.fn(), setAnalog: vi.fn() };
  const peek = vi.fn(() => runtime);
  const router = createRuntimeCommandRouter({ active, peek } as unknown as Pick<RuntimeHub, "active" | "peek">);
  return { router, runtime, get: peek };
}

describe("runtime command router (plan P3.4)", () => {
  it("turns the run commands of a browser run into runtime calls", () => {
    const { router, runtime } = setup("browser");
    const send = (message: WSMessage) => router.route(message);

    expect([
      send({ type: "pause_simulation" }), send({ type: "resume_simulation" }), send({ type: "stop_simulation" }),
      send({ type: "code_changed" }), send({ type: "serial_input", data: "hi\n" }),
    ]).toEqual([true, true, true, true, true]);

    expect(runtime.pause).toHaveBeenCalledTimes(1);
    expect(runtime.resume).toHaveBeenCalledTimes(1);
    expect(runtime.stop).toHaveBeenCalledTimes(2); // stop and code change
    expect(runtime.sendSerial).toHaveBeenCalledWith("hi\n");
  });

  it("drives digital pins, and analog pins above 1 as analog values", () => {
    const { router, runtime } = setup("browser");

    router.route({ type: "set_pin_value", pin: 2, value: 1 });
    router.route({ type: "set_pin_value", pin: 14, value: 1 });
    router.route({ type: "set_pin_value", pin: 14, value: 600 });
    router.route({ type: "set_pin_value", pin: 5, value: 600 });

    expect(runtime.setPin.mock.calls).toEqual([[2, 1], [14, 1], [5, 600]]);
    expect(runtime.setAnalog.mock.calls).toEqual([[14, 600]]);
  });

  it("leaves start, compile-time messages and everything else to the connection", () => {
    const { router, runtime } = setup("browser");

    expect(router.route({ type: "start_simulation", timeout: 30 })).toBe(false);
    expect(router.route({ type: "pin_state", pin: 1, stateType: "value", value: 1 })).toBe(false);
    expect(runtime.stop).not.toHaveBeenCalled();
  });

  it.each([["host-mock" as const], [undefined]])("sends nothing to the browser runtime when the active run is %s", (active) => {
    const { router, get } = setup(active);

    expect(router.route({ type: "stop_simulation" })).toBe(false);
    expect(router.setAnalog(14, 100)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("sets analog values from sliders in a browser run", () => {
    const { router, runtime } = setup("browser");

    expect(router.setAnalog(15, 321)).toBe(true);
    expect(runtime.setAnalog).toHaveBeenCalledWith(15, 321);
  });
});

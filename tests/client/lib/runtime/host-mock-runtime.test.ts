import { describe, expect, it, vi } from "vitest";
import type { WSMessage } from "@shared/schema";
import { HOST_MOCK_FEATURES, HostMockRuntime, type HostMockTransport } from "../../../../client/src/lib/runtime/host-mock-runtime";

function setup(options: { immediate?: boolean } = {}) {
  const sent: Array<{ via: "buffered" | "immediate"; message: WSMessage }> = [];
  let deliver: (raw: unknown) => void = () => undefined;
  const unsubscribe = vi.fn();
  const transport: HostMockTransport = {
    send: (message) => { sent.push({ via: "buffered", message }); return true; },
    sendImmediate: (message) => {
      if (options.immediate === false) return false;
      sent.push({ via: "immediate", message });
      return true;
    },
    onMessage: (listener) => { deliver = listener; return unsubscribe; },
  };
  const runtime = new HostMockRuntime(transport);
  return { runtime, sent, deliver: (raw: unknown) => deliver(raw), unsubscribe };
}

const start = { kind: "host-mock", code: "void setup(){} void loop(){}", headers: [], timeoutSec: 60 } as const;

describe("HostMockRuntime (plan P3.3)", () => {
  it("describes itself as the server-side runtime", () => {
    const { runtime } = setup();

    expect(runtime.kind).toBe("host-mock");
    expect(runtime.features).toEqual(HOST_MOCK_FEATURES);
    expect(runtime.features).toMatchObject({ serialInput: true, pause: true, resetWithoutCompile: false, survivesConnectionLoss: false });
  });

  it("sends start_simulation like the controller: timeout, code, headers, entry file; unbuffered", () => {
    const { runtime, sent } = setup();

    runtime.start({ ...start, headers: [{ name: "pins.h", content: "#define LED 13" }], entryFile: "main.ino" });

    expect(sent).toEqual([{
      via: "immediate",
      message: { type: "start_simulation", timeout: 60, code: start.code, headers: [{ name: "pins.h", content: "#define LED 13" }], entryFile: "main.ino" },
    }]);
  });

  it("leaves out empty headers and the entry file, and falls back to the buffered send", () => {
    const { runtime, sent } = setup({ immediate: false });

    runtime.start(start);

    expect(sent).toEqual([{ via: "buffered", message: { type: "start_simulation", timeout: 60, code: start.code } }]);
  });

  it("refuses a start request meant for the browser", () => {
    const { runtime, sent } = setup();

    expect(() => runtime.start({ kind: "browser", artifact: {} as never, timeoutSec: 60 })).toThrow(TypeError);
    expect(sent).toEqual([]);
  });

  it("maps pause, resume, stop, serial input and pins onto the existing messages", () => {
    const { runtime, sent } = setup();

    runtime.pause();
    runtime.resume();
    runtime.stop();
    runtime.sendSerial("42\n");
    runtime.setPin(2, 1);
    runtime.setPin(14, 512);

    expect(sent).toEqual([
      { via: "buffered", message: { type: "pause_simulation" } },
      { via: "buffered", message: { type: "resume_simulation" } },
      { via: "immediate", message: { type: "stop_simulation" } },
      { via: "buffered", message: { type: "serial_input", data: "42\n" } },
      { via: "buffered", message: { type: "set_pin_value", pin: 2, value: 1 } },
      { via: "buffered", message: { type: "set_pin_value", pin: 14, value: 512 } },
    ]);
  });

  it("resets by stopping and starting the same request again; without a start it only stops", () => {
    const { runtime, sent } = setup();

    runtime.reset();
    expect(sent.map((entry) => entry.message.type)).toEqual(["stop_simulation"]);

    runtime.start(start);
    sent.length = 0;
    runtime.reset();
    expect(sent.map((entry) => entry.message.type)).toEqual(["stop_simulation", "start_simulation"]);
  });

  it("passes the server's run events on and nothing else", () => {
    const { runtime, deliver } = setup();
    const events: unknown[] = [];
    runtime.subscribe((event) => events.push(event));

    deliver({ type: "serial_output", data: "Hi\n" });
    deliver({ type: "simulation_status", status: "running" });
    deliver({ type: "pin_state_batch", states: [{ pin: 13, stateType: "value", value: 1 }], timestamp: 1 });
    deliver({ type: "operation_error", operation: "start_simulation", code: "SYSTEM_BUSY", message: "busy" });
    deliver({ type: "handshake", protocolVersion: "1.0.0" });
    deliver({ type: "serial_input", data: "echo" });
    deliver({ type: "nonsense" });
    deliver("text");

    expect(events.map((event) => (event as { type: string }).type)).toEqual(["serial_output", "simulation_status", "pin_state_batch", "operation_error"]);
  });

  it("stops delivering to a listener that unsubscribed, and to all after dispose", () => {
    const { runtime, deliver, unsubscribe } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = runtime.subscribe(first);
    runtime.subscribe(second);

    stopFirst();
    deliver({ type: "serial_output", data: "a" });
    runtime.dispose();
    deliver({ type: "serial_output", data: "b" });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

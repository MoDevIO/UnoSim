import { beforeEach, describe, expect, it, vi } from "vitest";

const manager = vi.hoisted(() => ({
  send: vi.fn(() => true),
  sendImmediate: vi.fn(() => true),
  on: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/websocket-manager", () => ({ getWebSocketManager: () => manager }));

import { createHostMockRuntime } from "../../../../client/src/lib/runtime/host-mock-runtime";

beforeEach(() => vi.clearAllMocks());

describe("createHostMockRuntime", () => {
  it("runs on the app's singleton WebSocket manager", () => {
    const runtime = createHostMockRuntime();

    runtime.pause();
    runtime.stop();

    expect(manager.on).toHaveBeenCalledWith("message", expect.any(Function));
    expect(manager.send).toHaveBeenCalledWith({ type: "pause_simulation" });
    expect(manager.sendImmediate).toHaveBeenCalledWith({ type: "stop_simulation" });
  });

  it("hands the manager's incoming messages to subscribers", () => {
    const received = vi.fn();
    const runtime = createHostMockRuntime();
    runtime.subscribe(received);
    const deliver = (manager.on.mock.calls[0] as unknown as [string, (raw: unknown) => void])[1];

    deliver({ type: "simulation_status", status: "stopped" });

    expect(received).toHaveBeenCalledWith({ type: "simulation_status", status: "stopped" });
  });
});

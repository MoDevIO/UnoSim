import { describe, expect, it } from "vitest";
import { isSimulateControlDisabled, type SimulateControlInput } from "@/lib/server-capabilities";

/** Start needs the server (the compile); a paused run of the browser emulation does not. */
describe("isSimulateControlDisabled", () => {
  const online: SimulateControlInput = { canSimulate: true, simulationStatus: "idle", backendReachable: true, isConnected: true, busy: false, browserRun: false };
  const offline = { ...online, backendReachable: false, isConnected: false };

  it("is enabled with a reachable, connected server", () => {
    for (const simulationStatus of ["idle", "running", "paused", "queued"]) {
      expect(isSimulateControlDisabled({ ...online, simulationStatus })).toBe(false);
    }
  });

  it("disables Start and the Resume of a server-side run while the server is gone", () => {
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "idle" })).toBe(true);
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "paused", browserRun: false })).toBe(true);
  });

  it("keeps Resume of a paused browser run available without a connection", () => {
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "paused", browserRun: true })).toBe(false);
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "running", browserRun: true })).toBe(false);
  });

  it("does not let a browser run make Start available: the next start compiles on the server", () => {
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "idle", browserRun: true })).toBe(true);
  });

  it("is disabled while a request is in flight or when simulating is not possible, whatever the run", () => {
    expect(isSimulateControlDisabled({ ...online, busy: true })).toBe(true);
    expect(isSimulateControlDisabled({ ...offline, simulationStatus: "paused", browserRun: true, busy: true })).toBe(true);
    expect(isSimulateControlDisabled({ ...online, canSimulate: false })).toBe(true);
  });

  it("treats a lost WebSocket like an unreachable backend for Start, not for a paused browser run", () => {
    const socketLost = { ...online, isConnected: false };

    expect(isSimulateControlDisabled({ ...socketLost, simulationStatus: "idle" })).toBe(true);
    expect(isSimulateControlDisabled({ ...socketLost, simulationStatus: "paused", browserRun: true })).toBe(false);
  });
});

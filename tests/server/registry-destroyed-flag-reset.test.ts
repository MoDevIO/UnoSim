import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IOPinRecord } from "@shared/schema";
import type { TelemetryMetrics } from "../../server/services/sandbox/execution-manager";
import { RegistryManager } from "../../server/services/registry-manager";
import { PinStateBatcher } from "../../server/services/pin-state-batcher";

describe("RegistryManager destroyed flag reset after simulation", () => {
  let manager: RegistryManager;
  let telemetryCallback: ReturnType<typeof vi.fn>;
  let updateCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    telemetryCallback = vi.fn<(metrics: TelemetryMetrics) => void>();
    updateCallback =
      vi.fn<
        (
          registry: IOPinRecord[],
          baudrate: number | undefined,
          reason?: string,
        ) => void
      >();

    manager = new RegistryManager({
      onTelemetry: telemetryCallback,
      onUpdate: updateCallback,
      enableTelemetry: true,
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("should have destroyed=false initially", () => {
    // Manager should be ready for heartbeat
    const batcher = new PinStateBatcher("test");

    // Should start heartbeat without being destroyed
    manager.setPinStateBatcher(batcher);

    expect(telemetryCallback).not.toHaveBeenCalled(); // Not called yet (no tick)

    batcher.destroy();
  });

  it("should reset destroyed flag when reset() is called", () => {
    const batcher = new PinStateBatcher({ onBatch: () => {} });
    manager.setPinStateBatcher(batcher);

    // Now destroy the manager
    manager.destroy();

    // The manager should have destroyed=true now
    // But when we call reset(), it should reset destroyed=false
    manager.reset();

    // Now we should be able to start a new heartbeat
    const batcher2 = new PinStateBatcher({ onBatch: () => {} });
    manager.setPinStateBatcher(batcher2);

    vi.advanceTimersByTime(1000);
    expect(telemetryCallback.mock.calls.length).toBeGreaterThan(0);
    batcher2.destroy();
  });

  it("should fire heartbeat on consecutive simulations", () => {
    const batcher1 = new PinStateBatcher({ onBatch: () => {} });
    manager.setPinStateBatcher(batcher1);

    vi.advanceTimersByTime(1000);
    expect(telemetryCallback.mock.calls.length).toBeGreaterThan(0);

    // Simulate end of first simulation and reset for the next one.
    batcher1.destroy();
    manager.destroy();
    manager.reset();
    telemetryCallback.mockClear();

    const batcher2 = new PinStateBatcher({ onBatch: () => {} });
    manager.setPinStateBatcher(batcher2);
    vi.advanceTimersByTime(1000);

    expect(telemetryCallback.mock.calls.length).toBeGreaterThan(0);
    batcher2.destroy();
  });
});

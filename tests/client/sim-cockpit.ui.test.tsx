import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SimCockpit } from "@/components/features/sim-cockpit";
import { telemetryStore } from "@/hooks/use-telemetry-store";
import type { BatchStats } from "@/hooks/use-simulation-store";

describe("SimCockpit UI", () => {
  const fixedNow = 1_000_000;
  const baseMetrics = {
    timestamp: fixedNow,
    intendedPinChangesPerSecond: 100,
    actualPinChangesPerSecond: 80,
    droppedPinChangesPerSecond: 20,
    batchesPerSecond: 20,
    avgStatesPerBatch: 4,
    serialOutputPerSecond: 10,
    serialBytesPerSecond: 120,
    serialBytesTotal: 1200,
  };

  beforeEach(() => {
    telemetryStore.resetTelemetry();
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders SimCockpit with Server and State display", () => {
    telemetryStore.pushTelemetry(baseMetrics);

    const batchStats: BatchStats = {
      lastBatchMs: 1,
      lastBatchSize: 5,
      lastFrameAt: fixedNow,
    };

    render(<SimCockpit batchStats={batchStats} simulationStatus="running" backendReachable={true} isConnected={true} />);

    // SimCockpit should render server status and simulation state
    expect(screen.getByText("Server")).toBeDefined();
    expect(screen.getByText("ONLINE")).toBeDefined();
    expect(screen.getByText("State")).toBeDefined();
    expect(screen.getByText("RUNNING")).toBeDefined();
  });
});

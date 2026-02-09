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

  it("renders SimCockpit with Link State display", () => {
    telemetryStore.pushTelemetry(baseMetrics);

    const batchStats: BatchStats = {
      lastBatchMs: 1,
      lastBatchSize: 5,
      lastFrameAt: fixedNow,
    };

    render(<SimCockpit batchStats={batchStats} simulationStatus="running" />);

    // SimCockpit should render with Link State indicator
    // According to Phase C.3 concept, this component only shows Link State now
    expect(screen.getByText("Link State")).toBeDefined();
    expect(screen.getByText("STABLE")).toBeDefined();
  });
});

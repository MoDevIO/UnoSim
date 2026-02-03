import { render, screen } from "@testing-library/react";
// ...existing code...
import { SimCockpit } from "@/components/features/sim-cockpit";
import { telemetryStore } from "@/hooks/use-telemetry-store";
import type { BatchStats } from "@/hooks/use-simulation-store";

describe("SimCockpit UI", () => {
  const fixedNow = 1_000_000;
  const baseMetrics = {
    incomingEvents: 10,
    sentBatches: 1,
    eventsPerSecond: 6,
    batchEfficiency: 10,
    timestamp: fixedNow,
  };

  beforeEach(() => {
    telemetryStore.resetTelemetry();
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("derives UI Hz from batchStats frame timing", () => {
    telemetryStore.pushTelemetry(baseMetrics);

    const firstBatch: BatchStats = {
      lastBatchMs: 1,
      lastBatchSize: 5,
      lastFrameAt: fixedNow,
    };

    const { rerender } = render(<SimCockpit batchStats={firstBatch} />);

    telemetryStore.pushTelemetry({
      ...baseMetrics,
      eventsPerSecond: 1570,
      timestamp: fixedNow + 1000,
    });

    const secondBatch: BatchStats = {
      lastBatchMs: 1,
      lastBatchSize: 10,
      lastFrameAt: fixedNow + 50, // 50ms frame interval -> 20Hz
    };

    rerender(<SimCockpit batchStats={secondBatch} />);

    expect(screen.getByText("20.0")).toBeInTheDocument();
  });
});

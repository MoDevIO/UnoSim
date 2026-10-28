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

  it("renders the accessible server status icon in normal mode", () => {
    telemetryStore.pushTelemetry(baseMetrics);

    const batchStats: BatchStats = {
      lastBatchMs: 1,
      lastBatchSize: 5,
      lastFrameAt: fixedNow,
    };

    render(<SimCockpit batchStats={batchStats} simulationStatus="running" backendReachable={true} isConnected={true} />);

    // Normal mode shows the server status icon without a text label.
    expect(screen.getByRole("status", { name: "Server connected" })).toBeInTheDocument();
    expect(screen.queryByText("SERVER")).not.toBeInTheDocument();
  });
});

describe("SimCockpit browser run (plan P3.6)", () => {
  it("shows engine and real-time factor instead of the runner slot, in debug mode", () => {
    render(
      <SimCockpit
        debugMode
        simulationStatus="running"
        wsConnectionState="connected"
        wsHasEverConnected
        workerIndex={1}
        workerTotal={4}
        browserRun={{ active: true, realTimeFactor: 1.5 }}
      />,
    );

    expect(screen.getByTestId("browser-run-info")).toHaveTextContent("ENGINE:BROWSER|×1.50");
    expect(screen.queryByText("#2/4")).toBeNull();
  });

  it("shows the engine without a factor until telemetry arrives, and the runner slot for other runs", () => {
    const { rerender } = render(<SimCockpit debugMode simulationStatus="running" browserRun={{ active: true }} />);
    expect(screen.getByTestId("browser-run-info")).toHaveTextContent("ENGINE:BROWSER");
    expect(screen.queryByTestId("real-time-factor")).toBeNull();

    rerender(<SimCockpit debugMode simulationStatus="running" wsConnectionState="connected" wsHasEverConnected workerIndex={1} workerTotal={4} browserRun={{ active: false }} />);
    expect(screen.queryByTestId("browser-run-info")).toBeNull();
    expect(screen.getByText("#2/4")).toBeInTheDocument();
  });
});

describe("SimCockpit engine label (debug bar)", () => {
  it("names the browser engine while idle, without the WS dot or a runner slot", () => {
    render(<SimCockpit debugMode simulationStatus="idle" engine="browser" browserRun={{ active: false }} wsConnectionState="connected" wsHasEverConnected />);

    expect(screen.getByTestId("browser-run-info")).toHaveTextContent("ENGINE:BROWSER");
    expect(screen.queryByTestId("real-time-factor")).toBeNull();
    expect(screen.queryByText("WS:")).toBeNull();
  });

  it("names the legacy engine next to the WS dot and the runner slot", () => {
    render(<SimCockpit debugMode simulationStatus="running" engine="host-mock" wsConnectionState="connected" wsHasEverConnected workerIndex={0} workerTotal={5} />);

    expect(screen.getByTestId("legacy-engine-info")).toHaveTextContent("LEGACY");
    expect(screen.getByText("WS:")).toBeInTheDocument();
    expect(screen.getByText("#1/5")).toBeInTheDocument();
  });

  it("shows no engine name when the engine is unknown", () => {
    render(<SimCockpit debugMode simulationStatus="idle" wsConnectionState="connected" wsHasEverConnected />);

    expect(screen.queryByTestId("legacy-engine-info")).toBeNull();
    expect(screen.queryByTestId("browser-run-info")).toBeNull();
  });
});

import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimCockpit } from "@/components/features/sim-cockpit";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

vi.mock("@/hooks/use-telemetry-store", () => ({
  useTelemetryStore: vi.fn(),
}));

const mockedUseTelemetryStore = vi.mocked(useTelemetryStore);

const createTelemetryStoreMock = (
  overrides: Partial<ReturnType<typeof useTelemetryStore>> = {},
): ReturnType<typeof useTelemetryStore> => ({
  history: [],
  last: null,
  lastHeartbeatAt: null,
  pushTelemetry: vi.fn(),
  resetTelemetry: vi.fn(),
  ...overrides,
});

describe("SimCockpit", () => {
  beforeEach(() => {
    mockedUseTelemetryStore.mockReset();
  });

  it("shows SERVER in normal mode when backend is reachable", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={true} />);

    expect(getByText("SERVER")).toBeInTheDocument();
  });

  it("shows WS ✗ in normal mode when HTTP is reachable but WS disconnected", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={false} />);

    expect(getByText("WS ✗")).toBeInTheDocument();
  });

  it("shows OFFLINE in normal mode when backend HTTP is unreachable", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={false} isConnected={false} />);

    expect(getByText("OFFLINE")).toBeInTheDocument();
  });

  it("shows simulation state in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit simulationStatus="running" debugMode={true} />);

    expect(getByText("RUNNING")).toBeInTheDocument();
  });

  it("shows WS indicator dot in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText, container } = render(<SimCockpit debugMode={true} />);

    expect(getByText("WS")).toBeInTheDocument();
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("shows Docker label in debug mode when heartbeat is recent", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: Date.now() }),
    );

    const { getByText, container } = render(
      <SimCockpit simulationStatus="running" sandboxMode="docker-sandbox" workerIndex={1} workerTotal={3} debugMode={true} />,
    );

    expect(getByText("Docker")).toBeInTheDocument();
    expect(getByText("#2/3")).toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-400")).toBeInTheDocument();
  });

  it("shows Local label in debug mode for local-limited sandbox", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(
      <SimCockpit sandboxMode="local-limited" debugMode={true} />,
    );

    expect(getByText("Local")).toBeInTheDocument();
  });

  it("shows pool and compile stats in debug mode when serverStatus is provided", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const serverStatus = {
      pool: { total: 8, available: 5, inUse: 3, queued: 0 },
      compile: { active: 2, queued: 0, maxConcurrent: 8 },
    };

    const { getByText } = render(<SimCockpit serverStatus={serverStatus} debugMode={true} />);

    expect(getByText("Pool")).toBeInTheDocument();
    expect(getByText("GCC")).toBeInTheDocument();
    expect(getByText("3/8")).toBeInTheDocument();
  });
});

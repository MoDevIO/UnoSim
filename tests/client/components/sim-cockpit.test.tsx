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

  it("shows Server ONLINE when backend is reachable and connected", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={true} />);

    expect(getByText("Server")).toBeInTheDocument();
    expect(getByText("ONLINE")).toBeInTheDocument();
  });

  it("shows WS DOWN when HTTP is reachable but WebSocket is disconnected", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={false} />);

    expect(getByText("WS DOWN")).toBeInTheDocument();
  });

  it("shows HTTP DOWN when backend HTTP is unreachable", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit backendReachable={false} isConnected={false} />);

    expect(getByText("HTTP DOWN")).toBeInTheDocument();
  });

  it("shows simulation state label", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit simulationStatus="running" />);

    expect(getByText("State")).toBeInTheDocument();
    expect(getByText("RUNNING")).toBeInTheDocument();
  });

  it("shows WS link state in debugMode", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit debugMode={true} />);

    expect(getByText("WS Link")).toBeInTheDocument();
    expect(getByText("DISCONNECTED")).toBeInTheDocument();
  });

  it("shows Docker Sandbox label in debugMode when heartbeat is recent", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: Date.now() }),
    );

    const { getByText, container } = render(
      <SimCockpit simulationStatus="running" sandboxMode="docker-sandbox" workerIndex={1} workerTotal={3} debugMode={true} />,
    );

    expect(getByText("STABLE")).toBeInTheDocument();
    expect(getByText("Docker Sandbox")).toBeInTheDocument();
    expect(getByText("#2 / 3")).toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("shows local-limited sandbox label in debugMode", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(
      <SimCockpit sandboxMode="local-limited" debugMode={true} />,
    );

    expect(getByText("Local Limited")).toBeInTheDocument();
  });

  it("shows pool and compile stats when serverStatus is provided", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const serverStatus = {
      pool: { total: 8, available: 5, inUse: 3, queued: 0 },
      compile: { active: 2, queued: 0, maxConcurrent: 8 },
    };

    const { getByText } = render(<SimCockpit serverStatus={serverStatus} />);

    expect(getByText("Runners")).toBeInTheDocument();
    expect(getByText("Compile")).toBeInTheDocument();
    expect(getByText("3/8")).toBeInTheDocument();
  });
});

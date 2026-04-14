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

describe("SimCockpit — normal mode (no debugMode prop)", () => {
  beforeEach(() => {
    mockedUseTelemetryStore.mockReset();
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
  });

  it("shows SERVER when backend is reachable and WS is connected", () => {
    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={true} />);
    expect(getByText("SERVER")).toBeInTheDocument();
  });

  it("shows WS ✗ when HTTP is reachable but WebSocket is disconnected", () => {
    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={false} />);
    expect(getByText("WS ✗")).toBeInTheDocument();
  });

  it("shows OFFLINE when backend HTTP is unreachable", () => {
    const { getByText } = render(<SimCockpit backendReachable={false} isConnected={false} />);
    expect(getByText("OFFLINE")).toBeInTheDocument();
  });

  it("renders green dot when server is online", () => {
    const { container } = render(<SimCockpit backendReachable={true} isConnected={true} />);
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("renders red dot when server is offline", () => {
    const { container } = render(<SimCockpit backendReachable={false} isConnected={false} />);
    expect(container.querySelector(".bg-red-600")).toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode", () => {
  beforeEach(() => {
    mockedUseTelemetryStore.mockReset();
  });

  it("shows simulation state label", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit simulationStatus="running" debugMode={true} />);
    expect(getByText("RUNNING")).toBeInTheDocument();
  });

  it.each([
    ["paused", "PAUSED"],
    ["compiling", "COMPILING"],
    ["queued", "QUEUED"],
    ["stopped", "STOPPED"],
    ["idle", "IDLE"],
  ] as const)("shows %s state label", (status, label) => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit simulationStatus={status} debugMode={true} />);
    expect(getByText(label)).toBeInTheDocument();
  });

  it("shows ON label when server online in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={true} debugMode={true} />);
    expect(getByText("ON")).toBeInTheDocument();
  });

  it("shows WS✗ label when HTTP up but WS down in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit backendReachable={true} isConnected={false} debugMode={true} />);
    expect(getByText("WS✗")).toBeInTheDocument();
  });

  it("shows OFF label when HTTP down in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit backendReachable={false} isConnected={false} debugMode={true} />);
    expect(getByText("OFF")).toBeInTheDocument();
  });

  it("shows WS dot green when heartbeat is recent", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock({ lastHeartbeatAt: Date.now() }));
    const { container } = render(<SimCockpit isConnected={true} debugMode={true} />);
    expect(container.querySelector(".bg-emerald-400")).toBeInTheDocument();
  });

  it("shows WS dot red when no recent heartbeat", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock({ lastHeartbeatAt: null }));
    const { container } = render(<SimCockpit debugMode={true} />);
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("shows Docker label in debug mode for docker-sandbox", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock({ lastHeartbeatAt: Date.now() }));
    const { getByText } = render(
      <SimCockpit sandboxMode="docker-sandbox" workerIndex={1} workerTotal={3} debugMode={true} />,
    );
    expect(getByText("Docker")).toBeInTheDocument();
    expect(getByText("#2/3")).toBeInTheDocument();
  });

  it("shows Local label in debug mode for local-limited", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getByText } = render(<SimCockpit sandboxMode="local-limited" debugMode={true} />);
    expect(getByText("Local")).toBeInTheDocument();
  });

  it("shows — label for unknown sandbox mode in debug mode", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getAllByText } = render(<SimCockpit sandboxMode="unknown" debugMode={true} />);
    // "—" appears for both mode label and runner label (no index provided)
    expect(getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("shows — runner label when worker indices are not provided", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { getAllByText } = render(<SimCockpit debugMode={true} />);
    // "—" appears for both mode and runner label
    expect(getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("shows pool and GCC stats when serverStatus is provided", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const serverStatus = {
      pool: { total: 8, available: 5, inUse: 3, queued: 0 },
      compile: { active: 2, queued: 0, maxConcurrent: 8 },
    };
    const { getByText } = render(<SimCockpit serverStatus={serverStatus} debugMode={true} />);
    expect(getByText("Pool")).toBeInTheDocument();
    expect(getByText("GCC")).toBeInTheDocument();
    expect(getByText("3/8")).toBeInTheDocument();
  });

  it("shows queue indicators when pool queue is non-zero", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const serverStatus = {
      pool: { total: 5, available: 0, inUse: 5, queued: 3 },
      compile: { active: 8, queued: 5, maxConcurrent: 8 },
    };
    const { getAllByText } = render(<SimCockpit serverStatus={serverStatus} debugMode={true} />);
    expect(getAllByText("+3q")[0]).toBeInTheDocument();
    expect(getAllByText("+5q")[0]).toBeInTheDocument();
  });

  it("does not show pool stats when serverStatus is null", () => {
    mockedUseTelemetryStore.mockReturnValue(createTelemetryStoreMock());
    const { queryByText } = render(<SimCockpit serverStatus={null} debugMode={true} />);
    expect(queryByText("Pool")).not.toBeInTheDocument();
    expect(queryByText("GCC")).not.toBeInTheDocument();
  });
});

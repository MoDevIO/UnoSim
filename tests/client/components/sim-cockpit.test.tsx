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

  it("shows disconnected state when there is no recent heartbeat", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(<SimCockpit />);

    expect(getByText("DISCONNECTED")).toBeInTheDocument();
    expect(getByText("Unknown")).toBeInTheDocument();
  });

  it("shows Docker Sandbox label and active state when heartbeat is recent", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: Date.now() }),
    );

    const { getByText, container } = render(
      <SimCockpit simulationStatus="running" sandboxMode="docker-sandbox" workerIndex={1} workerTotal={3} />,
    );

    expect(getByText("STABLE")).toBeInTheDocument();
    expect(getByText("Docker Sandbox")).toBeInTheDocument();
    expect(getByText("#2 / 3")).toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("shows local-limited sandbox label when sandboxMode is local-limited", () => {
    mockedUseTelemetryStore.mockReturnValue(
      createTelemetryStoreMock({ lastHeartbeatAt: null }),
    );

    const { getByText } = render(
      <SimCockpit sandboxMode="local-limited" />,
    );

    expect(getByText("Local Limited")).toBeInTheDocument();
  });
});

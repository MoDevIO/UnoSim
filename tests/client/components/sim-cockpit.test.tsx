import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SimCockpit } from "@/components/features/sim-cockpit";

describe("SimCockpit — normal mode (no debugMode prop)", () => {
  it("shows SERVER when backend is reachable", () => {
    const { getByText } = render(<SimCockpit backendReachable={true} />);
    expect(getByText("SERVER")).toBeInTheDocument();
  });

  it("shows OFFLINE when backend is unreachable", () => {
    const { getByText } = render(<SimCockpit backendReachable={false} />);
    expect(getByText("OFFLINE")).toBeInTheDocument();
  });

  it("renders green dot when server is online", () => {
    const { container } = render(<SimCockpit backendReachable={true} />);
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });

  it("renders red dot when server is offline", () => {
    const { container } = render(<SimCockpit backendReachable={false} />);
    expect(container.querySelector(".bg-red-600")).toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — stat cell labels", () => {
  it("renders CLIENT, COMPILATION, SIMULATION group labels plus HTTP:, WS:, SLOT: inline labels", () => {
    const { getByText, queryByText } = render(<SimCockpit debugMode={true} />);
    expect(getByText("CLIENT")).toBeInTheDocument();
    expect(getByText("COMPILATION")).toBeInTheDocument();
    expect(getByText("SIMULATION")).toBeInTheDocument();
    expect(getByText("HTTP:")).toBeInTheDocument();
    expect(getByText("WS:")).toBeInTheDocument();
    expect(getByText("SLOT:")).toBeInTheDocument();
    // BAUD / TEL/S / BYTES/TEL removed from new 3-group layout
    expect(queryByText("BAUD")).not.toBeInTheDocument();
    expect(queryByText("TEL/S")).not.toBeInTheDocument();
    expect(queryByText("BYTES/TEL")).not.toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — CLIENT state", () => {
  it("shows IDLE when idle + ready", () => {
    const { getByText } = render(<SimCockpit debugMode={true} />);
    expect(getByText("IDLE")).toBeInTheDocument();
  });

  it("shows RUNNING when simulationStatus is running", () => {
    const { getByText } = render(<SimCockpit simulationStatus="running" debugMode={true} />);
    expect(getByText("RUNNING")).toBeInTheDocument();
  });

  it("shows PAUSED when simulationStatus is paused", () => {
    const { getByText } = render(<SimCockpit simulationStatus="paused" debugMode={true} />);
    expect(getByText("PAUSED")).toBeInTheDocument();
  });

  it("shows COMPILING when compilationStatus is compiling", () => {
    const { getByText } = render(
      <SimCockpit simulationStatus="idle" compilationStatus="compiling" debugMode={true} />,
    );
    expect(getByText("COMPILING")).toBeInTheDocument();
  });

  it("shows QUEUED_FOR_RUNNING after compile success + idle sim", () => {
    const { getByText } = render(
      <SimCockpit simulationStatus="idle" compilationStatus="success" debugMode={true} />,
    );
    expect(getByText("QUEUED_FOR_RUNNING")).toBeInTheDocument();
  });

  it("shows QUEUED_FOR_SIMULATION when simulationStatus is queued", () => {
    const { getByText } = render(
      <SimCockpit simulationStatus="queued" debugMode={true} />,
    );
    expect(getByText("QUEUED_FOR_SIMULATION")).toBeInTheDocument();
  });

  it("shows ERROR when compilationStatus is error", () => {
    const { getByText } = render(
      <SimCockpit simulationStatus="idle" compilationStatus="error" debugMode={true} />,
    );
    expect(getByText("ERROR")).toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — HTTP dot", () => {
  it("shows gray dot when compilation is ready (idle)", () => {
    const { container } = render(<SimCockpit compilationStatus="ready" debugMode={true} />);
    expect(container.querySelector(String.raw`.bg-white\/30`)).toBeInTheDocument();
  });

  it("shows blue pulsing dot when compiling", () => {
    const { container } = render(<SimCockpit compilationStatus="compiling" debugMode={true} />);
    expect(container.querySelector(".bg-blue-400.animate-pulse")).toBeInTheDocument();
  });

  it("shows red dot on compilation error", () => {
    const { container } = render(<SimCockpit compilationStatus="error" debugMode={true} />);
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — WS dot", () => {
  it("shows gray dot when never connected", () => {
    const { container } = render(<SimCockpit debugMode={true} wsHasEverConnected={false} />);
    expect(container.querySelector(String.raw`.bg-white\/30`)).toBeInTheDocument();
  });

  it("shows green dot when wsConnectionState is connected", () => {
    const { container } = render(<SimCockpit wsConnectionState="connected" debugMode={true} />);
    expect(container.querySelector(".bg-emerald-400")).toBeInTheDocument();
  });

  it("shows red dot when previously connected but now disconnected", () => {
    const { container } = render(
      <SimCockpit debugMode={true} wsHasEverConnected={true} wsConnectionState="disconnected" />,
    );
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });

  it("shows amber pulsing dot when reconnecting", () => {
    const { container } = render(
      <SimCockpit debugMode={true} wsConnectionState="reconnecting" />,
    );
    expect(container.querySelector(".bg-amber-400.animate-pulse")).toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — SLOT", () => {
  it("shows '—' when no workerIndex is provided", () => {
    const { getAllByText } = render(<SimCockpit debugMode={true} />);
    const dashes = getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("shows '#1/10' when workerIndex=0 and workerTotal=10", () => {
    const { getAllByText } = render(
      <SimCockpit debugMode={true} workerIndex={0} workerTotal={10} />,
    );
    // slot value appears in both COMPILATION and SIMULATION groups
    expect(getAllByText("#1/10").length).toBeGreaterThan(0);
  });

  it("shows '#3/5' when workerIndex=2 and workerTotal=5", () => {
    const { getAllByText } = render(
      <SimCockpit debugMode={true} workerIndex={2} workerTotal={5} />,
    );
    expect(getAllByText("#3/5").length).toBeGreaterThan(0);
  });

  it("shows '—' for SLOT when wsError (was connected, now disconnected)", () => {
    const { getAllByText } = render(
      <SimCockpit
        debugMode={true}
        workerIndex={0}
        workerTotal={10}
        wsHasEverConnected={true}
        wsConnectionState="disconnected"
      />,
    );
    // SLOT shows "—" on wsError even if workerIndex is provided
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("SimCockpit — debug mode — MODE", () => {
  it("shows DOCKER for docker-sandbox mode", () => {
    const { getByText } = render(<SimCockpit sandboxMode="docker-sandbox" debugMode={true} />);
    expect(getByText("DOCKER")).toBeInTheDocument();
  });

  it("shows LOCAL for local-limited mode", () => {
    const { getByText } = render(<SimCockpit sandboxMode="local-limited" debugMode={true} />);
    expect(getByText("LOCAL")).toBeInTheDocument();
  });

  it("hides MODE cell on WS error (previously connected, now disconnected)", () => {
    const { queryByText } = render(
      <SimCockpit
        sandboxMode="docker-sandbox"
        debugMode={true}
        wsHasEverConnected={true}
        wsConnectionState="disconnected"
      />,
    );
    expect(queryByText("DOCKER")).not.toBeInTheDocument();
  });

  it("shows '—' for unknown sandbox mode", () => {
    const { container } = render(<SimCockpit sandboxMode="unknown" debugMode={true} />);
    // MODE value is "—" for unknown mode
    expect(container.textContent).toContain("—");
  });
});

// BAUD / TEL/S / BYTES/TEL stat cells were removed from the debug layout
// (replaced by 3-group layout: CLIENT | COMPILATION | SIMULATION)

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SimCockpit } from "@/components/features/sim-cockpit";

describe("SimCockpit — normal mode (no debugMode prop)", () => {
  it("shows a non-interactive green CircleCheck status for a connected server", () => {
    const { getByRole, queryByRole } = render(<SimCockpit backendReachable={true} />);
    const status = getByRole("status", { name: "Server connected" });
    const icon = status.querySelector("svg");

    expect(status).toHaveAttribute("title", "Server connected");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Server connected");
    expect(status).toHaveClass("cursor-default");
    expect(status.className).not.toMatch(/(?:^|\s)(?:hover:|focus-visible:|border-|bg-|ring-|cursor-pointer)/);
    expect(status).not.toHaveAttribute("tabindex");
    expect(queryByRole("button")).not.toBeInTheDocument();
    expect(icon).toHaveClass("lucide-circle-check", "text-status-success");
  });

  it("shows a non-interactive red CircleX status for an offline server", () => {
    const { getByRole, queryByRole } = render(<SimCockpit backendReachable={false} />);
    const status = getByRole("status", { name: "Server offline" });
    const icon = status.querySelector("svg");

    expect(status).toHaveAttribute("title", "Server offline");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Server offline");
    expect(status).toHaveClass("cursor-default");
    expect(status.className).not.toMatch(/(?:^|\s)(?:hover:|focus-visible:|border-|bg-|ring-|cursor-pointer)/);
    expect(status).not.toHaveAttribute("tabindex");
    expect(queryByRole("button")).not.toBeInTheDocument();
    expect(icon).toHaveClass("lucide-circle-x", "text-status-error");
  });
});

describe("SimCockpit — debug mode — stat cell labels", () => {
  it("renders CLIENT, COMPILATION, SIMULATION group labels plus HTTP: and WS: inline labels", () => {
    const { getByText, queryByText } = render(<SimCockpit debugMode={true} />);
    expect(getByText("CLIENT")).toBeInTheDocument();
    expect(getByText("COMPILATION")).toBeInTheDocument();
    expect(getByText("SIMULATION")).toBeInTheDocument();
    expect(getByText("HTTP:")).toBeInTheDocument();
    expect(getByText("WS:")).toBeInTheDocument();
    // SLOT: is only shown while actively compiling
    expect(queryByText("SLOT:")).not.toBeInTheDocument();
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

  it("shows IDLE when compilationStatus is success but simulationStatus is idle (e.g. after stop)", () => {
    const { getByText } = render(
      <SimCockpit simulationStatus="idle" compilationStatus="success" debugMode={true} />,
    );
    expect(getByText("IDLE")).toBeInTheDocument();
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
  it("shows a labeled success dot when compilation is ready", () => {
    render(<SimCockpit compilationStatus="ready" debugMode={true} />);
    expect(screen.getByText("HTTP ready").parentElement).toHaveClass("bg-status-success");
  });

  it("shows a labeled busy dot when compiling", () => {
    render(<SimCockpit compilationStatus="compiling" debugMode={true} />);
    expect(screen.getByText("HTTP compiling").parentElement).toHaveClass("bg-accent-cyan", "animate-pulse");
  });

  it("shows a labeled error dot on compilation failure", () => {
    render(<SimCockpit compilationStatus="error" debugMode={true} />);
    expect(screen.getByText("HTTP error").parentElement).toHaveClass("bg-status-error");
  });

  it("shows a success dot after successful compilation", () => {
    render(<SimCockpit compilationStatus="success" debugMode={true} />);
    expect(screen.getByText("HTTP success").parentElement).toHaveClass("bg-status-success");
  });
});

describe("SimCockpit — debug mode — WS dot", () => {
  it("shows an idle dot when never connected", () => {
    render(<SimCockpit debugMode={true} wsHasEverConnected={false} />);
    expect(screen.getByText("WebSocket not connected").parentElement).toHaveClass("bg-muted-foreground");
  });

  it("shows a success dot when connected", () => {
    render(<SimCockpit wsConnectionState="connected" debugMode={true} />);
    expect(screen.getByText("WebSocket connected").parentElement).toHaveClass("bg-status-success");
  });

  it("shows an error dot when a prior connection is lost", () => {
    render(
      <SimCockpit debugMode={true} wsHasEverConnected={true} wsConnectionState="disconnected" />,
    );
    expect(screen.getByText("WebSocket disconnected").parentElement).toHaveClass("bg-status-error");
  });

  it("shows a pulsing busy dot when connecting", () => {
    render(
      <SimCockpit debugMode={true} wsConnectionState="connecting" />,
    );
    expect(screen.getByText("WebSocket connecting").parentElement).toHaveClass("bg-accent-cyan", "animate-pulse");
  });

  it("shows a pulsing busy dot when reconnecting", () => {
    render(
      <SimCockpit debugMode={true} wsConnectionState="reconnecting" />,
    );
    expect(screen.getByText("WebSocket reconnecting").parentElement).toHaveClass("bg-accent-cyan", "animate-pulse");
  });
});

describe("SimCockpit — debug mode — SLOT", () => {
  it("hides SLOT: when not actively compiling", () => {
    const { queryByText } = render(<SimCockpit debugMode={true} workerIndex={0} workerTotal={10} />);
    expect(queryByText("SLOT:")).not.toBeInTheDocument();
    expect(queryByText("#1/10")).not.toBeInTheDocument();
  });

  it("shows SLOT: and '#1/10' while compiling (workerIndex=0, workerTotal=10)", () => {
    const { getByText } = render(
      <SimCockpit debugMode={true} compilationStatus="compiling" workerIndex={0} workerTotal={10} />,
    );
    expect(getByText("SLOT:")).toBeInTheDocument();
    expect(getByText("#1/10")).toBeInTheDocument();
  });

  it("shows '#3/5' in SLOT while compiling (workerIndex=2, workerTotal=5)", () => {
    const { getByText } = render(
      <SimCockpit debugMode={true} compilationStatus="compiling" workerIndex={2} workerTotal={5} />,
    );
    expect(getByText("#3/5")).toBeInTheDocument();
  });

  it("hides SLOT on wsError even while compiling", () => {
    const { queryByText } = render(
      <SimCockpit
        debugMode={true}
        compilationStatus="compiling"
        workerIndex={0}
        workerTotal={10}
        wsHasEverConnected={true}
        wsConnectionState="disconnected"
      />,
    );
    expect(queryByText("SLOT:")).not.toBeInTheDocument();
    expect(queryByText("#1/10")).not.toBeInTheDocument();
  });
});

describe("SimCockpit — debug mode — simulation slot", () => {
  it("shows the runner slot without a redundant execution-mode label", () => {
    const { getByText, queryByText } = render(
      <SimCockpit
        simulationStatus="running"
        workerIndex={0}
        workerTotal={5}
        debugMode={true}
      />,
    );
    expect(getByText("#1/5")).toBeInTheDocument();
    expect(queryByText("—")).not.toBeInTheDocument();
    expect(queryByText("DOCKER")).not.toBeInTheDocument();
    expect(queryByText("LOCAL")).not.toBeInTheDocument();
  });
});

// BAUD / TEL/S / BYTES/TEL stat cells were removed from the debug layout
// (replaced by 3-group layout: CLIENT | COMPILATION | SIMULATION)

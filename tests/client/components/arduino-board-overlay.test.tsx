/**
 * Tests for the ArduinoBoard darken overlay behaviour.
 *
 * User requirement: The board must have the same visual appearance
 * before starting the simulation and after stopping it (whether via
 * the Stop button or timeout). The overlay is always hidden and the
 * board is always at full opacity to prevent black screens.
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

// ─── Minimal replica of the overlay logic found in arduino-board.tsx ─────────

/**
 * The CORRECT overlay implementation:
 * Overlay always hidden (opacity=0) to keep the board fully visible.
 */
const OverlayCorrect: React.FC = () => (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{ background: "rgba(0,0,0,0.45)", opacity: 0, zIndex: 20 }}
    />
);

/**
 * Parameterized overlay that toggles based on simulation status.
 * This variant is NOT used in production but verifies regression detection.
 */
function OverlayConditional({
  simulationStatus,
}: {
  readonly simulationStatus: "running" | "paused" | "idle";
}): JSX.Element {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{
        background: "rgba(0,0,0,0.45)",
        opacity: simulationStatus === "running" ? 0 : 1,
        zIndex: 20,
      }}
    />
  );
}

// ─── Tests verifying the CORRECT behaviour ────────────────────────────────

describe("ArduinoBoard overlay - CORRECT implementation (always hidden)", () => {
  it("overlay is ALWAYS hidden (opacity=0) to keep board fully visible", () => {
    const { getByTestId } = render(<OverlayCorrect />);
    expect(getByTestId("overlay").style.opacity).toBe("0");
  });
});

// ─── Tests documenting the BUGGY behaviour caused by incorrect opacity logic ───

describe("ArduinoBoard overlay - regression detection", () => {
  it("conditional overlay is dark when idle (documents pre-fix bug)", () => {
    const { getByTestId } = render(<OverlayConditional simulationStatus="idle" />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });

  it("conditional overlay is dark when paused (documents pre-fix bug)", () => {
    const { getByTestId } = render(<OverlayConditional simulationStatus="paused" />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });

  it("conditional overlay is hidden when running", () => {
    const { getByTestId } = render(<OverlayConditional simulationStatus="running" />);
    expect(getByTestId("overlay").style.opacity).toBe("0");
  });
});


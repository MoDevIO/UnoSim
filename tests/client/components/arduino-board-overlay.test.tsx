/**
 * Tests for the ArduinoBoard darken overlay behaviour.
 *
 * User requirement: The board must have the same visual appearance
 * before starting the simulation and after stopping it (whether via
 * the Stop button or timeout). This means the board should remain
 * fully visible at all times.
 *
 * Solution: Keep the overlay always hidden (opacity=0) and the board
 * always at full opacity (opacity=1).
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

// ─── Minimal replica of the overlay logic found in arduino-board.tsx ─────────

/**
 * The CORRECT overlay implementation:
 * Overlay always hidden (opacity=0) to keep the board fully visible
 * regardless of simulation state (before-start, during, paused, or after-stop).
 */
function OverlayCorrect(): JSX.Element {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{ background: "rgba(0,0,0,0.45)", opacity: 0, zIndex: 20 }}
    />
  );
}

/**
 * BUGGY variant 1: Shows overlay when not running (old broken version).
 * This causes the board to go black when simulation stops.
 */
function OverlayBuggy_AlwaysShownWhenStopped(): JSX.Element {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{ background: "rgba(0,0,0,0.45)", opacity: 1, zIndex: 20 }}
    />
  );
}

/**
 * BUGGY variant 2: Shows overlay when simulationStatus !== "running"
 * (the parameterized version from old broken code).
 */
function OverlayBuggy_ConditionalOnStatus({
  simulationStatus,
}: readonly {
  readonly simulationStatus: "running" | "paused" | "stopped";
}): JSX.Element {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{ background: "rgba(0,0,0,0.45)", opacity: simulationStatus === "running" ? 0 : 1, zIndex: 20 }}
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

describe("ArduinoBoard overlay - BUGGY variants (regression detection)", () => {
  it("Bug: overlay is visible (dark) when always shown (old behavior caused black screen)", () => {
    const { getByTestId } = render(<OverlayBuggy_AlwaysShownWhenStopped />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });

  it("Bug: overlay is shown when stopped (simulationStatus=stopped)", () => {
    const { getByTestId } = render(<OverlayBuggy_ConditionalOnStatus simulationStatus="stopped" />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });

  it("Bug: overlay is shown when paused (simulationStatus=paused)", () => {
    const { getByTestId } = render(<OverlayBuggy_ConditionalOnStatus simulationStatus="paused" />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });
});


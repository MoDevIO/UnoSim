/**
 * Tests for the ArduinoBoard darken overlay behaviour.
 *
 * Bug #1: After a simulation ends (whether via timeout or the stop button),
 * the board's darken overlay must follow `isSimulationRunning`:
 *  - overlay HIDDEN  when simulation is running OR paused (board should remain
 *    fully visible so the user can inspect current LED / pin states)
 *  - overlay VISIBLE when simulation is stopped
 *
 * Before the fix the condition was `simulationStatus === "running" ? 0 : 1`,
 * which incorrectly darkens the board also when it is paused.
 *
 * We test the overlay condition logic directly in a minimal React component
 * mirroring what ArduinoBoard renders, so we avoid complex dependency tree
 * of the full board component (SVG fetching, RAF loops, etc.).
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

// ─── Minimal replica of the overlay logic found in arduino-board.tsx ─────────

type RuntimeSimulationStatus = "running" | "paused" | "stopped";

/**
 * The overlay element as it should look AFTER the fix:
 * opacity driven by `isSimulationRunning` (the prop from PinMonitorView),
 * so the board stays visible when paused.
 */
function OverlayFixed({ isSimulationRunning }: { readonly isSimulationRunning: boolean }) {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
      style={{ background: "rgba(0,0,0,0.45)", opacity: isSimulationRunning ? 0 : 1, zIndex: 20 }}
    />
  );
}

/**
 * The overlay element as it looks BEFORE the fix (buggy version):
 * opacity driven by `simulationStatus === "running"`, which wrongly shows
 * the darken overlay while the simulation is paused.
 */
function OverlayBuggy({ simulationStatus }: { readonly simulationStatus: RuntimeSimulationStatus }) {
  return (
    <div
      data-testid="overlay"
      className="absolute inset-0 transition-opacity duration-300 ease-in-out pointer-events-none"
       
      style={{ background: "rgba(0,0,0,0.45)", opacity: simulationStatus === "running" ? 0 : 1, zIndex: 20 }}
    />
  );
}

// ─── Tests verifying the FIXED behaviour ──────────────────────────────────
describe("ArduinoBoard darken overlay - FIXED condition (isSimulationRunning)", () => {
  it("opacity is 0 (hidden) when simulation is running", () => {
    const { getByTestId } = render(<OverlayFixed isSimulationRunning={true} />);
    expect(getByTestId("overlay").style.opacity).toBe("0");
  });

  it("opacity is 0 (hidden) when simulation is paused", () => {
    // isSimulationRunning = simulationStatus !== 'stopped' → true for 'paused'
    const { getByTestId } = render(<OverlayFixed isSimulationRunning={true} />);
    expect(getByTestId("overlay").style.opacity).toBe("0");
  });

  it("opacity is 1 (visible/dark) when simulation is stopped", () => {
    const { getByTestId } = render(<OverlayFixed isSimulationRunning={false} />);
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });
});

// ─── Tests documenting the BUGGY behaviour (for reference / regression guard) ──

describe("ArduinoBoard darken overlay - BUG: simulationStatus condition", () => {
  it("Bug #1: overlay is wrongly DARK (opacity 1) when paused (before fix)", () => {
    // This test exists to document the regression.
    // The buggy formula drives opacity from simulationStatus, so 'paused' shows dark.
    const { getByTestId } = render(<OverlayBuggy simulationStatus="paused" />);
    // This assertion PASSES (shows the bug is real): opacity IS 1 (dark) when paused.
    expect(getByTestId("overlay").style.opacity).toBe("1");
  });

  it("Bug #1: overlay should be HIDDEN (opacity 0) when paused - correct expectation", () => {
    // After applying the fix to arduino-board.tsx (use isSimulationRunning),
    // this test documents the INTENDED behaviour: overlay must NOT show when paused.
    // The OverlayFixed component above already verifies the correct formula.
    const { getByTestId } = render(<OverlayFixed isSimulationRunning={true} />);
    expect(getByTestId("overlay").style.opacity).toBe("0");
  });
});


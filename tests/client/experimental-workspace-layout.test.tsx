import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  ExperimentalWorkspace,
  WorkspaceVisibilityControls,
} from "@/components/simulator/ExperimentalWorkspace";
import { useExperimentalWorkspaceLayout } from "@/hooks/use-experimental-workspace-layout";
import {
  DEFAULT_WORKSPACE_COLUMN_VISIBILITY,
  getVisibleWorkspaceColumns,
  getWorkspaceDefaultSizes,
  getWorkspaceResizePairs,
} from "@/lib/experimental-workspace-layout";

describe("experimental workspace layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts disabled and keeps Code + Simulation as the default columns", () => {
    expect(DEFAULT_WORKSPACE_COLUMN_VISIBILITY).toEqual({
      code: true,
      simulation: true,
      tutor: false,
    });
    expect(getVisibleWorkspaceColumns(DEFAULT_WORKSPACE_COLUMN_VISIBILITY)).toEqual([
      "code",
      "simulation",
    ]);
    expect(getWorkspaceDefaultSizes(["code", "simulation"])).toEqual([50, 50]);
    expect(getWorkspaceDefaultSizes(["code", "simulation", "tutor"])).toEqual([42, 33, 25]);
  });

  it("only creates resize pairs between visible neighboring columns", () => {
    expect(getWorkspaceResizePairs(["code", "simulation"])).toEqual([
      ["code", "simulation"],
    ]);
    expect(getWorkspaceResizePairs(["code", "tutor"])).toEqual([
      ["code", "tutor"],
    ]);
    expect(getWorkspaceResizePairs([])).toEqual([]);
  });

  it("updates the experimental setting and preserves column visibility choices", () => {
    const { result } = renderHook(() => useExperimentalWorkspaceLayout());

    expect(result.current.enabled).toBe(false);
    act(() => result.current.setExperimentalEnabled(true));
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem("unoExperimentalWorkspaceLayout")).toBe("1");

    act(() => result.current.setColumnVisible("tutor", true));
    expect(result.current.visibleColumns).toEqual(["code", "simulation", "tutor"]);

    act(() => result.current.setColumnVisible("code", false));
    expect(result.current.visibleColumns).toEqual(["simulation", "tutor"]);

    act(() => result.current.restoreDefaultLayout());
    expect(result.current.visibleColumns).toEqual(["code", "simulation"]);
  });

  it("reacts to the settings event without remounting the layout", () => {
    const { result } = renderHook(() => useExperimentalWorkspaceLayout());

    act(() => {
      globalThis.dispatchEvent(
        new CustomEvent("experimentalWorkspaceLayoutChange", { detail: { value: true } }),
      );
    });

    expect(result.current.enabled).toBe(true);
  });

  it("exposes independent visibility toggles", () => {
    const onToggle = vi.fn();
    render(
      <WorkspaceVisibilityControls
        visibility={{ code: true, simulation: true, tutor: false }}
        onColumnToggle={onToggle}
        onRestoreDefault={() => undefined}
      />,
    );

    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("workspace-toggle-tutor"));
    expect(onToggle).toHaveBeenCalledWith("tutor");
  });

  it("shows an explicit empty state when every column is hidden", () => {
    render(
      <ExperimentalWorkspace
        visibility={{ code: false, simulation: false, tutor: false }}
        visibleColumns={[]}
        sizes={{ code: 42, simulation: 33, tutor: 25 }}
        setColumnVisible={vi.fn()}
        restoreDefaultLayout={vi.fn()}
        setSizes={vi.fn()}
        codeColumn={<div>code</div>}
        simulationColumn={<div>simulation</div>}
      />,
    );

    expect(screen.getByTestId("workspace-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code anzeigen" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-restore-default")).toBeInTheDocument();
  });

  it("renders only the two separators needed for three visible columns", () => {
    render(
      <ExperimentalWorkspace
        visibility={{ code: true, simulation: true, tutor: true }}
        visibleColumns={["code", "simulation", "tutor"]}
        sizes={{ code: 42, simulation: 33, tutor: 25 }}
        setColumnVisible={vi.fn()}
        restoreDefaultLayout={vi.fn()}
        setSizes={vi.fn()}
        codeColumn={<div>code</div>}
        simulationColumn={<div>simulation</div>}
      />,
    );

    expect(screen.getByTestId("workspace-resizer-code-simulation")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-resizer-simulation-tutor")).toBeInTheDocument();
    expect(screen.getAllByTestId(/workspace-resizer-/)).toHaveLength(2);
  });
});

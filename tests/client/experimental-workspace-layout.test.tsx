import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  ExperimentalWorkspace,
  TutorWorkspacePlaceholder,
  WorkspaceVisibilityControls,
} from "@/components/simulator/ExperimentalWorkspace";
import type { TutorPanelState } from "@/hooks/use-tutor";
import { useTutor } from "@/hooks/use-tutor";
import { useExperimentalWorkspaceLayout } from "@/hooks/use-experimental-workspace-layout";
import {
  DEFAULT_WORKSPACE_COLUMN_VISIBILITY,
  getVisibleWorkspaceColumns,
  getWorkspaceDefaultSizes,
  getWorkspaceResizePairs,
} from "@/lib/experimental-workspace-layout";
import SimulatorOutputContainer from "@/components/simulator/sub-components/SimulatorOutputContainer";

describe("experimental workspace layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      />,
    );

    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveClass("ring-primary/60");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveClass("opacity-60");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("title", "Code ausblenden");
    expect(screen.getByTestId("workspace-toggle-simulation")).toHaveAttribute("title", "Simulation ausblenden");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveAttribute("title", "Tutor einblenden");
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-restore-default")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workspace-toggle-tutor"));
    expect(onToggle).toHaveBeenCalledWith("tutor");
  });

  it("shows an explicit empty state when every column is hidden", () => {
    const restoreDefaultLayout = vi.fn();
    render(
      <ExperimentalWorkspace
        visibleColumns={[]}
        sizes={{ code: 42, simulation: 33, tutor: 25 }}
        setColumnVisible={vi.fn()}
        restoreDefaultLayout={restoreDefaultLayout}
        setSizes={vi.fn()}
        codeColumn={<div>code</div>}
        simulationColumn={<div>simulation</div>}
      />,
    );

    expect(screen.getByTestId("workspace-empty-state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Code anzeigen" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-restore-default")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workspace-restore-default"));
    expect(restoreDefaultLayout).toHaveBeenCalledOnce();
  });

  it("renders only the two separators needed for three visible columns", () => {
    render(
      <ExperimentalWorkspace
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
    expect(screen.getByTestId("workspace-column-code")).toHaveClass("bg-background");
    expect(screen.getByTestId("workspace-column-simulation")).toHaveClass("border-l", "border-border/40");
    expect(screen.getByTestId("workspace-column-tutor")).toHaveClass("border-l", "border-border/40");
    expect(screen.getByTestId("workspace-resizer-code-simulation")).toHaveClass(
      "bg-border/45",
      "hover:bg-primary/70",
    );
    expect(screen.getByTestId("tutor-panel")).toHaveTextContent("Learning questions panel");
    expect(screen.getByTestId("tutor-panel").querySelector("svg")).toBeInTheDocument();
  });

  it("embeds the serial output and board panels in the simulation column", () => {
    render(
      <SimulatorOutputContainer
        embedded
        serialSlot={<div>serial output</div>}
        boardSlot={<div>board</div>}
      />,
    );

    expect(screen.getByText("serial output")).toBeInTheDocument();
    expect(screen.getByText("board")).toBeInTheDocument();
    expect(screen.getByTestId("vertical-resizer-board")).toBeInTheDocument();
  });

  it("renders the compact tutor header, key view, and dialog actions", () => {
    const submitAnswer = vi.fn();
    const resetDialog = vi.fn();
    const generateQuestion = vi.fn();
    const tutor: TutorPanelState = {
      config: { mode: "user-key", provider: "kiconnect" },
      credential: "volatile-key",
      setCredential: vi.fn(),
      clearCredential: vi.fn(),
      selectedModel: "auto",
      setSelectedModel: vi.fn(),
      availableModels: [],
      modelsLoading: false,
      loadModels: vi.fn(),
      question: {
        question: "Was beobachtest du?",
        provider: "kiconnect",
        mode: "user-key",
        model: "pilot-model",
      },
      history: [],
      answer: "Meine Antwort",
      setAnswer: vi.fn(),
      submitAnswer,
      resetDialog,
      isLoading: false,
      error: null,
      generateQuestion,
    };

    const { rerender } = render(<TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} />);

    expect(screen.getByLabelText("Your answer")).toBeInTheDocument();
    expect(screen.getByTestId("tutor-api-key-action")).toHaveAttribute("aria-label", "API key");
    expect(screen.getByTestId("tutor-api-key-action")).toHaveAttribute("title", "API key");
    expect(screen.getByTestId("tutor-api-key-action").querySelector("svg")).toHaveClass("!h-5", "!w-5");
    expect(screen.getByTestId("tutor-new-question-action")).toHaveAttribute("aria-label", "New learning question");
    expect(screen.getByTestId("tutor-new-question-action")).toHaveClass("h-9", "w-9", "rounded-full");
    expect(screen.getByTestId("tutor-new-question-action").querySelector("svg")).toHaveClass("!h-6", "!w-6");
    fireEvent.click(screen.getByTestId("tutor-api-key-action"));
    expect(screen.getByTestId("tutor-api-key-view")).toBeInTheDocument();
    expect(screen.getByLabelText("API key", { selector: "input" })).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(tutor.loadModels).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();
    const sendAnswerButton = screen.getByRole("button", { name: "Send answer" });
    expect(sendAnswerButton).toHaveClass("h-9", "w-9");
    expect(sendAnswerButton).not.toBeDisabled();
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={{ ...tutor, answer: "" }} />);
    expect(screen.getByRole("button", { name: "Send answer" })).toBeDisabled();
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} />);
    fireEvent.click(sendAnswerButton);
    expect(submitAnswer).toHaveBeenCalledWith("void setup(){}");
    submitAnswer.mockClear();
    const answerField = screen.getByLabelText("Your answer");
    fireEvent.keyDown(answerField, { key: "Enter", code: "Enter", shiftKey: false });
    expect(submitAnswer).toHaveBeenCalledWith("void setup(){}");
    submitAnswer.mockClear();
    fireEvent.keyDown(answerField, { key: "Enter", code: "Enter", shiftKey: true });
    expect(submitAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tutor-new-question-action"));
    expect(resetDialog).toHaveBeenCalledOnce();
    expect(generateQuestion).toHaveBeenCalledWith("void setup(){}");
  });

  it("restores the KI:connect key flow with automatic model loading", async () => {
    const modelsRequestBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/config") {
        return new Response(JSON.stringify({
          tutor: { mode: "user-key", provider: "kiconnect" },
        }), { status: 200 });
      }
      if (String(input) === "/api/tutor/models") {
        modelsRequestBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });

    function TutorHarness() {
      const tutor = useTutor();
      return <TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} />;
    }

    render(<TutorHarness />);
    await waitFor(() => expect(screen.getByTestId("tutor-api-key-action")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tutor-api-key-action"));
    const keyInput = screen.getByLabelText("API key", { selector: "input" });
    expect(keyInput).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();

    fireEvent.change(keyInput, { target: { value: "volatile-key" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "pilot-model" })).toBeInTheDocument());
    expect(modelsRequestBodies).toEqual([{ credential: "volatile-key" }]);

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "pilot-model" } });
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tutor-api-key-action"));
    expect(screen.getByLabelText("API key", { selector: "input" })).toHaveValue("volatile-key");
    expect(screen.getByLabelText("Model")).toHaveValue("pilot-model");
    expect(modelsRequestBodies).toEqual([
      { credential: "volatile-key" },
      { credential: "volatile-key" },
    ]);
    expect(localStorage.length).toBe(0);
  });
});

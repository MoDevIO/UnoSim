import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  ExperimentalWorkspace,
  TutorWorkspacePlaceholder,
  WorkspaceVisibilityControls,
} from "@/components/simulator/ExperimentalWorkspace";
import type { TutorPanelState } from "@/hooks/use-tutor";
import { useTutor } from "@/hooks/use-tutor";
import { useExperimentalWorkspaceLayout } from "@/hooks/use-experimental-workspace-layout";
import { getServerCapabilities } from "@/lib/server-capabilities";
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

    const controls = screen.getByTestId("experimental-workspace-controls");
    expect(controls).toHaveClass("flex", "items-center", "gap-1");
    expect(controls).not.toHaveClass("border", "bg-background/80", "shadow-xs");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveClass("text-status-success");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveClass("text-muted-foreground");
    expect(screen.getByTestId("workspace-toggle-code")).not.toHaveClass("bg-primary/20", "ring-1", "shadow-inner");
    expect(screen.getByTestId("workspace-toggle-tutor")).not.toHaveClass("bg-muted/30", "opacity-60");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveClass("h-[var(--ui-button-height)]", "w-[var(--ui-button-height)]");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("aria-label", "Hide code workspace");
    expect(screen.getByTestId("workspace-toggle-code")).toHaveAttribute("title", "Hide code workspace");
    expect(screen.getByTestId("workspace-toggle-simulation")).toHaveAttribute("title", "Hide simulation workspace");
    expect(screen.getByTestId("workspace-toggle-tutor")).toHaveAttribute("title", "Show tutor workspace");
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
    expect(screen.getByTestId("workspace-column-simulation")).toHaveClass("border-l");
    expect(screen.getByTestId("workspace-column-tutor")).toHaveClass("border-l");
    expect(screen.getByTestId("workspace-resizer-code-simulation")).toHaveClass("workspace-experimental-horizontal-handle");
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

  it("focuses the panel on the current question and keeps settings, difficulty and the model out of the learning step", async () => {
    const submitAnswer = vi.fn();
    const resetDialog = vi.fn();
    const generateQuestion = vi.fn();
    const tutor: TutorPanelState = {
      capabilities: getServerCapabilities(true),
      config: { provider: "kiconnect" },
      credential: "volatile-key",
      setCredential: vi.fn(),
      clearCredential: vi.fn(),
      selectedModel: "auto",
      setSelectedModel: vi.fn(),
      lastUsedModel: "pilot-model",
      configuredDifficulty: 30,
      effectiveDifficulty: 42,
      setConfiguredDifficulty: vi.fn(),
      sessionRating: null,
      ratedAnswerCount: 0,
      availableModels: [],
      modelsLoading: false,
      loadModels: vi.fn(),
      question: {
        question: "Was beobachtest du?",
        difficulty: 34,
        provider: "kiconnect",
        model: "pilot-model",
      },
      focusProgress: null,
      history: [],
      transcript: [],
      support: null,
      completed: false,
      requestSupport: vi.fn(),
      answer: "Meine Antwort",
      setAnswer: vi.fn(),
      submitAnswer,
      resetDialog,
      isLoading: false,
      error: null,
      errorCode: null,
      failedRequest: null, retryFor: () => null, awaitingNext: false, continueToNextQuestion: vi.fn(),
      pendingRequest: "answer",
      generateQuestion,
    };

    const { rerender } = render(<TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} />);

    // The learning step loads when the Tutor column opens.
    const answerField = await screen.findByLabelText("Deine Antwort oder Rückfrage");
    expect(answerField).toHaveFocus();
    expect(screen.getByText("Tutor", { exact: true })).toHaveClass("text-status-success");
    expect(screen.getByTestId("tutor-panel").querySelector("svg.lucide-graduation-cap")).toHaveClass("text-status-success");
    expect(screen.getByTestId("tutor-status-icon")).toHaveAttribute("aria-label", "Tutor wartet auf deine Antwort");
    expect(screen.getByTestId("tutor-status-icon").querySelector("svg")).toHaveClass("toolbar-icon-button-animation-waiting");
    // The question, then the answer field: no difficulty, ratings, model or key action in the learning step.
    expect(screen.getByTestId("tutor-question")).toHaveTextContent("Aktuelle FrageWas beobachtest du?");
    expect(screen.getByTestId("tutor-question").compareDocumentPosition(answerField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/^D\d+$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-effective-difficulty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-session-rating")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-last-used-model")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-history-action")).not.toBeInTheDocument();
    // Without a support state of the server there is no help to offer.
    expect(screen.queryByTestId("tutor-help-toggle")).not.toBeInTheDocument();

    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} debugMode />);
    expect(screen.getByTestId("tutor-last-used-model")).toHaveTextContent("pilot-model");

    const send = screen.getByTestId("tutor-send-answer");
    expect(send).toHaveTextContent("Senden");
    fireEvent.click(send);
    expect(submitAnswer).toHaveBeenCalledWith("void setup(){}");
    submitAnswer.mockClear();
    fireEvent.keyDown(answerField, { key: "Enter", code: "Enter", shiftKey: false });
    expect(submitAnswer).toHaveBeenCalledWith("void setup(){}");
    submitAnswer.mockClear();
    fireEvent.keyDown(answerField, { key: "Enter", code: "Enter", shiftKey: true });
    expect(submitAnswer).not.toHaveBeenCalled();
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={{ ...tutor, answer: "  " }} />);
    expect(screen.getByTestId("tutor-send-answer")).toBeDisabled();
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={{ ...tutor, isLoading: true }} />);
    expect(screen.getByTestId("tutor-send-answer")).toBeDisabled();
    expect(screen.getByTestId("tutor-pending")).toHaveTextContent("Tutor prüft deine Eingabe …");

    // Settings from the menu: key, model, start and current difficulty; leaving keeps the draft and asks nothing.
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={tutor} />);
    fireEvent.keyDown(screen.getByTestId("tutor-menu"), { key: "Enter" });
    fireEvent.click(await screen.findByTestId("tutor-api-key-action"));
    expect(await screen.findByTestId("tutor-api-key-view")).toBeInTheDocument();
    expect(screen.getByLabelText("API-Key", { selector: "input" })).toBeInTheDocument();
    expect(screen.getByLabelText("Modell")).toBeInTheDocument();
    expect(screen.getByLabelText("Startschwierigkeit (1–100)")).toHaveValue(30);
    expect(screen.getByTestId("tutor-effective-difficulty")).toHaveTextContent("Aktuelle Schwierigkeit dieser Lernrunde: 42 von 100");
    expect(screen.getByTestId("tutor-transparency")).toHaveTextContent("KI:connect.nrw");
    expect(tutor.loadModels).toHaveBeenCalledOnce();
    expect(screen.getByTestId("tutor-settings-back")).toHaveTextContent("Zurück zur Frage");
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Deine Antwort oder Rückfrage")).toHaveValue("Meine Antwort");
    expect(generateQuestion).not.toHaveBeenCalled();
    expect(resetDialog).not.toHaveBeenCalled();

    // A new learning round is the deliberate reset of the menu.
    fireEvent.keyDown(screen.getByTestId("tutor-menu"), { key: "Enter" });
    const newRound = await screen.findByTestId("tutor-new-round-action");
    expect(newRound).toHaveTextContent("Neue Lernrunde starten");
    expect(newRound.querySelector("svg.lucide-message-circle-plus")).toBeInTheDocument();
    fireEvent.click(newRound);
    expect(resetDialog).toHaveBeenCalledOnce();
    expect(generateQuestion).toHaveBeenCalledWith("void setup(){}");
    await waitFor(() => expect(screen.queryByTestId("tutor-new-round-action")).not.toBeInTheDocument());

    // An answer that closed the question: the question stays with the answer, its feedback and its stars;
    // `Weiter` is the one way on and takes the focus. The average belongs to the history.
    const turn = { question: "Was beobachtest du?", answer: "Der Pin ist HIGH.", feedback: "Richtig.", answerRating: 4 as const, responseStyle: "normal" as const };
    const continueToNextQuestion = vi.fn();
    const answered = {
      ...tutor, answer: "", history: [turn], transcript: [{ id: "turn-1", kind: "turn" as const, turn }],
      sessionRating: 4, ratedAnswerCount: 1, awaitingNext: true, continueToNextQuestion,
    };
    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={answered} />);
    const next = await screen.findByTestId("tutor-continue");
    expect(next).toHaveTextContent("Weiter zur nächsten Frage");
    expect(next).toHaveFocus();
    expect(screen.getByTestId("tutor-question")).toHaveTextContent("Beantwortete FrageWas beobachtest du?");
    const step = screen.getByTestId("tutor-current-step");
    expect(step).toHaveTextContent("Deine AntwortDer Pin ist HIGH.");
    expect(within(step).getByTestId("tutor-answer-rating")).toHaveTextContent("★★★★☆");
    expect(step).toHaveTextContent("Richtig.");
    expect(screen.queryByTestId("tutor-session-rating")).not.toBeInTheDocument();
    // No answer and no help for a question that is answered.
    expect(screen.queryByLabelText("Deine Antwort oder Rückfrage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-send-answer")).not.toBeInTheDocument();
    expect(screen.getByTestId("tutor-status-icon")).toHaveAttribute("aria-label", "Tutor bereit");
    fireEvent.click(next);
    expect(continueToNextQuestion).toHaveBeenCalledOnce();
    expect(submitAnswer).not.toHaveBeenCalled();

    // After `Weiter` the next question stands alone; earlier stars and the average are in the history.
    rerender(<TutorWorkspacePlaceholder
      code="void setup(){}"
      tutor={{ ...answered, awaitingNext: false, answer: "Meine Antwort", question: { ...tutor.question!, question: "Und was passiert danach?" } }}
    />);
    expect(await screen.findByTestId("tutor-question")).toHaveTextContent("Aktuelle FrageUnd was passiert danach?");
    expect(screen.queryByTestId("tutor-previous-feedback")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-answer-rating")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tutor-continue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tutor-history-action"));
    expect(await screen.findByTestId("tutor-answer-rating")).toHaveTextContent("★★★★☆");
    expect(screen.getByTestId("tutor-session-rating")).toHaveTextContent("Durchschnitt der Verständnisbewertung: 4 von 5 aus 1 bewerteten Antwort");
    expect(screen.getByTestId("tutor-focus-status")).toHaveTextContent("Freier Tutor");
    fireEvent.click(screen.getByTestId("tutor-back-to-question"));
    expect(screen.getByLabelText("Deine Antwort oder Rückfrage")).toHaveValue("Meine Antwort");
  });

  it("offers only the action that fits: set up the Tutor, then start a question", async () => {
    const generateQuestion = vi.fn();
    const base = {
      capabilities: getServerCapabilities(true), config: { provider: "kiconnect" }, credential: "",
      setCredential: vi.fn(), clearCredential: vi.fn(), selectedModel: "auto", setSelectedModel: vi.fn(), lastUsedModel: null,
      configuredDifficulty: 30, effectiveDifficulty: 30, setConfiguredDifficulty: vi.fn(), sessionRating: null, ratedAnswerCount: 0,
      availableModels: [], modelsLoading: false, loadModels: vi.fn(), question: null, focusProgress: null, history: [], transcript: [],
      support: null, completed: false, requestSupport: vi.fn(), answer: "", setAnswer: vi.fn(), submitAnswer: vi.fn(), resetDialog: vi.fn(),
      isLoading: false, error: null, errorCode: null, failedRequest: null, retryFor: () => null, awaitingNext: false, continueToNextQuestion: vi.fn(), pendingRequest: "question", generateQuestion,
    } satisfies TutorPanelState;
    const { rerender } = render(<TutorWorkspacePlaceholder code="void setup(){}" tutor={base} />);
    await screen.findByTestId("tutor-setup");
    expect(screen.getByTestId("tutor-status-icon")).toHaveAttribute("aria-label", "Tutor nicht eingerichtet");
    expect(screen.getByTestId("tutor-transparency")).toHaveTextContent("dein aktueller Sketch an KI:connect.nrw übertragen");
    expect(screen.queryByTestId("tutor-start-question")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Deine Antwort oder Rückfrage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tutor-setup-action"));
    expect(await screen.findByTestId("tutor-api-key-view")).toBeInTheDocument();
    expect(screen.getByTestId("tutor-settings-back")).toHaveTextContent(/^Zurück$/);

    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={{ ...base, credential: "key" }} />);
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    expect(screen.queryByTestId("tutor-setup-action")).not.toBeInTheDocument();
    expect(screen.getByTestId("tutor-transparency")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tutor-start-question"));
    expect(generateQuestion).toHaveBeenCalledWith("void setup(){}");

    rerender(<TutorWorkspacePlaceholder code="void setup(){}" tutor={{ ...base, credential: "key", isLoading: true }} />);
    expect(screen.getByTestId("tutor-start-question")).toBeDisabled();
    expect(screen.getByTestId("tutor-pending")).toHaveTextContent("Tutor erstellt eine Frage …");
    expect(screen.getByTestId("tutor-status-icon")).toHaveAttribute("aria-label", "Tutor erstellt eine Frage");
  });

  it("restores the KI:connect key flow with automatic model loading", async () => {
    const modelsRequestBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/config") {
        return new Response(JSON.stringify({
          tutor: { provider: "kiconnect" },
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
    await waitFor(() => expect(screen.getByTestId("tutor-setup-action")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tutor-setup-action"));
    const keyInput = await screen.findByLabelText("API-Key", { selector: "input" });
    expect(keyInput).toBeInTheDocument();
    expect(screen.getByLabelText("Modell")).toBeInTheDocument();

    fireEvent.change(keyInput, { target: { value: "volatile-key" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "pilot-model" })).toBeInTheDocument());
    expect(modelsRequestBodies).toEqual([{ credential: "volatile-key" }]);

    fireEvent.change(screen.getByLabelText("Modell"), { target: { value: "pilot-model" } });
    fireEvent.click(screen.getByTestId("tutor-apply-key"));
    expect(screen.queryByTestId("tutor-api-key-view")).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("tutor-menu"), { key: "Enter" });
    fireEvent.click(await screen.findByTestId("tutor-api-key-action"));
    expect(await screen.findByLabelText("API-Key", { selector: "input" })).toHaveValue("volatile-key");
    expect(screen.getByLabelText("Modell")).toHaveValue("pilot-model");
    expect(modelsRequestBodies).toEqual([
      { credential: "volatile-key" },
      { credential: "volatile-key" },
    ]);
    expect(localStorage).toHaveLength(0);
  });
});

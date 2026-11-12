import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tutorReviewEnvelopeSchema } from "../../../../shared/tutor-review";
import { checkTutorMermaid } from "../../../../shared/tutor-mermaid-rules";
import { KiconnectProvider } from "../../../../server/services/tutor/kiconnect-provider";
import { TUTOR_PROMPT_REVISION, TutorService } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import type { CurriculumQuestion, CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { getTutorDiagnostics, getTutorReview, withTutorDiagnostics } from "../../../../server/services/tutor/tutor-diagnostics";

/**
 * The delivered graphic belongs to the delivered question (Plan Aufgabe 5, GQ-01..GQ-03). The real
 * provider adapter parses a controlled OpenAI-compatible response; TutorService, the planner and the
 * diagnostics are real. Only the network endpoint is simulated.
 */

const SKETCH = "int value = 3; void setup() { Serial.println(value); } void loop() {}";
const GRAPHIC = "flowchart LR\n  A[value setzen] --> B[ausgeben] --> C[Ende]";
const Q1: CurriculumQuestion = {
  id: "first-question", concept: "variable-values", indicator: "value-use", kind: "concept", difficulty: [1, 50],
  requires: [{ fact: "serial-call", values: ["print"] }], text: "Welche Rolle hat value im Sketch?",
};
const Q2: CurriculumQuestion = { ...Q1, id: "second-question", kind: "application", text: "Wie wird value bei der seriellen Ausgabe verwendet?" };

function topic(): CurriculumTopic {
  return {
    schemaVersion: 1, id: "variables-and-serial", title: "Variablen", locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "variable-values", title: "Variablenwerte", objective: "Werte erklären", prerequisites: [],
      difficulty: { entry: [1, 50], transfer: [20, 80] }, misconceptions: [], indicators: [{ id: "value-use", description: "Wert und Verwendung" }],
      mastery: { minimumSuccessfulProbes: 1, successRatingAtLeast: 3, requiredIndicators: ["value-use"], minimumDistinctQuestionKinds: 1, recentWeakAnswersAllowed: 0 },
    }],
    questions: [Q1, Q2].map((question) => ({ ...question })), scaffolds: [],
    progression: { entryConcepts: ["variable-values"], preferredOrder: ["variable-values"], onRating: { "1-2": "remediate", "3": "clarify-same-indicator", "4": "probe-missing-indicator", "5": "evaluate-mastery-and-advance" } },
  };
}
const revision = "a".repeat(40);
const courseContent = () => ({
  revision, progressionState: createTutorProgressionState(revision),
  tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [topic()], strategies: [] },
});

afterEach(() => vi.unstubAllGlobals());

function stubProvider(content: Record<string, unknown>): void {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/models")
    ? { data: [{ id: "listed-model" }] }
    : { model: "listed-model", choices: [{ message: { content: JSON.stringify({ responseStyle: "normal", ...content }) } }] }), { status: 200 }));
}

async function inTrace<T>(operation: "question" | "answer", run: () => Promise<T>) {
  return withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation, credential: "key" }, async () => {
    const value = await run();
    return { value, diagnostics: getTutorDiagnostics()!.events, review: tutorReviewEnvelopeSchema.parse(getTutorReview({ id: TUTOR_PROMPT_REVISION.id, templateDigest: TUTOR_PROMPT_REVISION.templateDigest })) };
  });
}

/** Weak answer to Q1: the real planner remediates with the only unused question, Q2. */
const answerQ1Weakly = (service: TutorService) =>
  service.generateDialogResponse(SKETCH, [], Q1.text!, "keine Ahnung", "key", "listed-model", undefined, courseContent());

describe("GQ-01: a graphic that belonged to a replaced question is not shown with the new one", () => {
  it("drops the valid provider graphic when the real planner replaces the question, and says why", async () => {
    stubProvider({ answerRating: 2, feedback: "Noch nicht ganz.", question: "Wozu dient eine Variable im Allgemeinen?", mermaid: GRAPHIC });
    const { value, diagnostics, review } = await inTrace("answer", () => answerQ1Weakly(new TutorService(new KiconnectProvider(), new CurriculumTutorAdapter())));

    expect(value.result.question).toBe(Q2.text);
    expect(value.result.questionId).toBe(Q2.id);
    expect(value.result.mermaid).toBeUndefined();
    // The assessment is the provider's, untouched by the graphic decision.
    expect(value.result.answerRating).toBe(2);
    expect(value.result.feedback).toBe("Noch nicht ganz.");

    const safety = diagnostics.filter((event) => event.stage === "safety");
    expect(safety).toMatchObject([{ outcome: "accepted" }]);
    const content = diagnostics.filter((event) => event.stage === "content");
    expect(content).toMatchObject([{ outcome: "discarded", reason: "question-replaced" }]);
    // The same graphic identity runs through both events: the discarded graphic is the one that passed the safety check.
    expect(content[0]!.diagramId).toBeDefined();
    expect(content[0]!.diagramId).toBe(safety[0]!.diagramId);

    expect(review.entries.find((entry) => entry.kind === "draft")).toMatchObject({ question: "Wozu dient eine Variable im Allgemeinen?", mermaid: GRAPHIC });
    expect(review.entries.find((entry) => entry.kind === "decision")).toMatchObject({ trigger: "planner-question", before: "Wozu dient eine Variable im Allgemeinen?", after: Q2.text });
    expect(review.entries.find((entry) => entry.kind === "outcome")).toMatchObject({ followUpSource: "planner", question: Q2.text, graphic: "discarded" });
  });

  it("an application fallback question replaces a repeated one and takes the graphic with it", async () => {
    stubProvider({ answerRating: 5, feedback: "Richtig.", question: Q1.text, mermaid: GRAPHIC });
    const { value, diagnostics } = await inTrace("answer", () => new TutorService(new KiconnectProvider())
      .generateDialogResponse(SKETCH, [], Q1.text!, "value speichert 3 und wird ausgegeben.", "key", "listed-model"));
    expect(value.result.question).not.toBe(Q1.text);
    expect(value.result.mermaid).toBeUndefined();
    expect(diagnostics.filter((event) => event.stage === "content")).toMatchObject([{ outcome: "discarded", reason: "question-replaced" }]);
  });
});

describe("GQ-02: without a replaced question the graphic is delivered unchanged", () => {
  it("keeps the graphic when the provider's question is the planned one; nodes, edges and identity are those of the draft", async () => {
    stubProvider({ answerRating: 2, feedback: "Noch nicht ganz.", question: Q2.text, mermaid: GRAPHIC });
    const { value, diagnostics, review } = await inTrace("answer", () => answerQ1Weakly(new TutorService(new KiconnectProvider(), new CurriculumTutorAdapter())));

    expect(value.result.question).toBe(Q2.text);
    expect(value.result.mermaid).toBe(GRAPHIC);
    // Concrete nodes and edges, read off the delivered text (not just "some graphic").
    const edges = value.result.mermaid!.split("\n").slice(1).flatMap((line) => line.split("-->").map((part) => part.trim()));
    expect(edges).toEqual(["A[value setzen]", "B[ausgeben]", "C[Ende]"]);
    expect(value.result.mermaid!.match(/-->/g)).toHaveLength(2);

    const safety = diagnostics.filter((event) => event.stage === "safety");
    const content = diagnostics.filter((event) => event.stage === "content");
    expect(safety).toMatchObject([{ outcome: "accepted" }]);
    expect(content).toMatchObject([{ outcome: "accepted" }]);
    expect(content[0]!.diagramId).toBe(safety[0]!.diagramId);
    expect(diagnostics.some((event) => event.reason === "question-replaced")).toBe(false);
    expect(review.entries.find((entry) => entry.kind === "outcome")).toMatchObject({ graphic: "kept", question: Q2.text });
  });
});

describe("GQ-03: absent, empty, safe, unsupported and forbidden graphics are different cases", () => {
  const QUESTION = "Wie lange bleibt die LED in jedem Durchlauf eingeschaltet?";
  const FEEDBACK = "Richtig, value wird ausgegeben.";

  async function dialogWith(mermaid: string | undefined) {
    stubProvider({ answerRating: 4, feedback: FEEDBACK, question: QUESTION, ...(mermaid === undefined ? {} : { mermaid }) });
    return inTrace("answer", () => new TutorService(new KiconnectProvider())
      .generateDialogResponse(SKETCH, [], Q1.text!, "value speichert 3.", "key", "listed-model"));
  }

  it.each([
    ["absent", undefined, "not-provided", "not-provided"],
    ["empty", "", "empty", "empty"],
    ["blank", "   ", "empty", "empty"],
  ] as const)("%s: no graphic, a parsing note and no rejection", async (_name, mermaid, outcome, reason) => {
    const { value, diagnostics } = await dialogWith(mermaid);
    expect(value.result.mermaid).toBeUndefined();
    expect(diagnostics.filter((event) => event.stage === "parsing")).toMatchObject([{ outcome, reason }]);
    expect(diagnostics.filter((event) => event.stage === "safety")).toHaveLength(0);
    // A missing graphic is information, not a security finding.
    expect(diagnostics.some((event) => event.outcome === "rejected" || event.outcome === "failed")).toBe(false);
    expect(value.result).toMatchObject({ question: QUESTION, answerRating: 4, feedback: FEEDBACK });
  });

  it("safe, supported: delivered with the question, rating and feedback unchanged", async () => {
    const { value, diagnostics } = await dialogWith(GRAPHIC);
    expect(value.result).toMatchObject({ question: QUESTION, answerRating: 4, feedback: FEEDBACK, mermaid: GRAPHIC });
    expect(diagnostics.filter((event) => event.stage === "safety")).toMatchObject([{ outcome: "accepted" }]);
  });

  it.each([
    ["unsupported diagram type", "pie title Anteile\n  \"a\": 1", "diagram-type-unsupported"],
    ["forbidden directive", "flowchart LR\n  A --> B\n  click A callback", "directive-disallowed"],
    ["markup", "flowchart LR\n  A[<b>x</b>] --> B", "markup-disallowed"],
    ["external content", "flowchart LR\n  A[https://example.org] --> B", "external-content-disallowed"],
  ] as const)("%s: rejected with the fixed reason; question, rating and feedback stay", async (_name, mermaid, reason) => {
    const { value, diagnostics } = await dialogWith(mermaid);
    expect(value.result.mermaid).toBeUndefined();
    expect(diagnostics.filter((event) => event.stage === "safety")).toMatchObject([{ outcome: "rejected", reason }]);
    // The shared rule gives the same reason: the renderer's contract is tested against it in the client suite.
    expect(checkTutorMermaid(mermaid)).toBe(reason);
    expect(value.result).toMatchObject({ question: QUESTION, answerRating: 4, feedback: FEEDBACK });
  });

  it("a graphic the server's coarse check accepts but the renderer cannot draw is still delivered as text for the renderer to refuse", async () => {
    // `subgraph` without `end`: the server rule has no syntax check of its own (see the client contract test).
    const unterminated = "flowchart LR\n  A --> B\n  subgraph S\n  A";
    const { value, diagnostics } = await dialogWith(unterminated);
    expect(value.result.mermaid).toBe(unterminated);
    expect(diagnostics.filter((event) => event.stage === "safety")).toMatchObject([{ outcome: "accepted" }]);
  });
});

describe("GQ-03: support answers carry text only", () => {
  it("a valid graphic in a hint is discarded by contract, the explanation stays", async () => {
    stubProvider({ feedback: "Schau auf den Aufruf von Serial.println.", question: Q1.text, mermaid: GRAPHIC });
    const { value, diagnostics } = await inTrace("answer", () => new TutorService(new KiconnectProvider()).generateSupportExplanation({
      kind: "hint", code: SKETCH, question: Q1.text!, credential: "key", requestedModel: "listed-model", earlierClarifications: [],
    }));
    expect(value.explanation).toBe("Schau auf den Aufruf von Serial.println.");
    expect("mermaid" in value).toBe(false);
    expect(diagnostics.filter((event) => event.stage === "content")).toMatchObject([{ outcome: "discarded", reason: "support-graphics-not-supported" }]);
  });
});

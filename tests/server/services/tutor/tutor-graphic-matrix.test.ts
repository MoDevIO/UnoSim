import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TutorDiagnosticEvent } from "../../../../shared/tutor-diagnostics";
import { KiconnectProvider } from "../../../../server/services/tutor/kiconnect-provider";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { getTutorDiagnostics, withTutorDiagnostics } from "../../../../server/services/tutor/tutor-diagnostics";

/**
 * Every Tutor request kind against every state a model graphic can arrive in. The real provider code parses
 * a controlled OpenAI-compatible response; only the network endpoint is simulated.
 */
const SKETCH = "const int led = 13;\nvoid setup() { pinMode(led, OUTPUT); }\nvoid loop() { digitalWrite(led, HIGH); delay(500); digitalWrite(led, LOW); delay(500); }";
const QUESTION = "Welche Aufgabe hat delay(500) in loop?";
const GRAPHICS = {
  absent: undefined,
  valid: "flowchart LR\n  A[LED an] --> B[warten] --> C[LED aus]",
  unsafe: "flowchart LR\n  A --> B\n  click A callback",
} as const;
type GraphicCase = keyof typeof GRAPHICS;
type Operation = "question" | "answer" | "support";

afterEach(() => vi.unstubAllGlobals());

function stubProvider(mermaid: string | undefined): void {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/models")
    ? { data: [{ id: "listed-model" }] }
    : {
      model: "listed-model-2026-11-01",
      choices: [{ message: { content: JSON.stringify({
        responseStyle: "normal",
        feedback: "Richtig, delay hält das Programm an.",
        question: "Wie lange bleibt die LED in jedem Durchlauf von loop eingeschaltet?",
        topic: "Zeitsteuerung",
        difficulty: 30,
        answerRating: 4,
        ...(mermaid === undefined ? {} : { mermaid }),
      }) } }],
    }), { status: 200 }));
}

async function run(operation: Operation, service: TutorService): Promise<string | undefined> {
  if (operation === "question") return (await service.generateQuestion(SKETCH, "key", "listed-model")).result.mermaid;
  if (operation === "answer") {
    return (await service.generateDialogResponse(SKETCH, [], QUESTION, "Sie wartet eine halbe Sekunde.", "key", "listed-model")).result.mermaid;
  }
  // Explanations and hints deliver text only; the response carries no graphic field at all.
  const support = await service.generateSupportExplanation({
    kind: "hint", code: SKETCH, question: QUESTION, credential: "key", requestedModel: "listed-model", earlierClarifications: [],
  });
  expect(support.explanation.length).toBeGreaterThan(0);
  return "mermaid" in support ? String(support.mermaid) : undefined;
}

async function scenario(operation: Operation, graphic: GraphicCase) {
  stubProvider(GRAPHICS[graphic]);
  return withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation, credential: "key" }, async () => {
    const delivered = await run(operation, new TutorService(new KiconnectProvider()));
    return { delivered, events: getTutorDiagnostics()!.events };
  });
}

const find = (events: readonly TutorDiagnosticEvent[], stage: TutorDiagnosticEvent["stage"]) => events.filter((event) => event.stage === stage);

describe.each(["question", "answer"] as const)("Tutor %s graphics", (operation) => {
  it("delivers no graphic and reports the missing field as information, not as a rejection", async () => {
    const { delivered, events } = await scenario(operation, "absent");
    expect(delivered).toBeUndefined();
    expect(find(events, "parsing")).toMatchObject([{ outcome: "not-provided", reason: "not-provided" }]);
    expect(find(events, "safety")).toHaveLength(0);
    expect(events.some((event) => event.outcome === "rejected" || event.outcome === "failed")).toBe(false);
  });

  it("delivers a valid graphic after parsing and the safety check accepted it", async () => {
    const { delivered, events } = await scenario(operation, "valid");
    expect(delivered).toBe(GRAPHICS.valid);
    expect(find(events, "parsing")).toMatchObject([{ outcome: "provided", diagramType: "flowchart" }]);
    // Exactly one safety event: the quality re-check of the final question must not report the graphic again.
    expect(find(events, "safety")).toMatchObject([{ outcome: "accepted" }]);
    expect(find(events, "safety")[0].diagramId).toBeDefined();
    expect(find(events, "content")).toMatchObject([{ outcome: "accepted" }]);
  });

  it("drops an unsafe graphic with a fixed reason and keeps the text", async () => {
    const { delivered, events } = await scenario(operation, "unsafe");
    expect(delivered).toBeUndefined();
    expect(find(events, "parsing")).toMatchObject([{ outcome: "provided" }]);
    expect(find(events, "safety")).toMatchObject([{ outcome: "rejected", reason: "directive-disallowed" }]);
  });

  it("names the provider's returned version next to the listed requested model", async () => {
    const { events } = await scenario(operation, "absent");
    const completed = find(events, "provider").find((event) => event.outcome === "completed");
    expect(completed).toMatchObject({ modelRequested: "listed-model", modelReturned: "listed-model-2026-11-01" });
    expect(completed?.reason).toBeUndefined();
  });
});

describe("Tutor support graphics", () => {
  it("delivers text only when the model sends no graphic", async () => {
    const { delivered, events } = await scenario("support", "absent");
    expect(delivered).toBeUndefined();
    expect(find(events, "parsing")).toMatchObject([{ outcome: "not-provided" }]);
    expect(find(events, "content")).toHaveLength(0);
  });

  it.each(["valid", "unsafe"] as const)("discards a %s graphic because hints carry text only", async (graphic) => {
    const { delivered, events } = await scenario("support", graphic);
    expect(delivered).toBeUndefined();
    expect(find(events, "content")).toMatchObject([{ outcome: "discarded", reason: "support-graphics-not-supported" }]);
  });
});

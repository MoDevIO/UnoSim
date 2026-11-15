import { describe, expect, it, vi } from "vitest";
import { tutorQuestionRequestSchema, tutorDialogRequestSchema } from "../../../../shared/tutor-requests";
import { tutorSupportRequestSchema } from "../../../../shared/tutor-support";
import { ensureTutorQuestionGraphic } from "../../../../server/services/tutor/tutor-question-graphics";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { type LLMProvider, type LLMProviderRequest, TutorProviderError } from "../../../../server/services/tutor/llm-provider";

const code = "void setup(){pinMode(13, OUTPUT);} void loop(){digitalWrite(13,HIGH);}";
const question = "Welche Wirkung hat der Aufruf digitalWrite in loop?";
const diagram = "flowchart LR\nA[loop] --> B[Ausgabe]";
const result = { question, responseStyle: "normal" as const };
function providerWith(output: unknown = { mermaid: diagram }) {
  return {
    listModels: vi.fn(async () => ["pilot-model"]),
    generateLearningQuestion: vi.fn(async (_request: LLMProviderRequest) => ({ model: "pilot-model", result })),
    generateGraphic: vi.fn(async (_request: LLMProviderRequest, _credential: string, _signal?: AbortSignal) => ({ model: "pilot-model", result: output })),
  };
}

describe("Tutor graphics mode request boundary", () => {
  const binding = { supportSession: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222", actionId: "33333333-3333-4333-8333-333333333333" };
  const requests = [
    [tutorQuestionRequestSchema, { code }],
    [tutorDialogRequestSchema, { code, history: [], question, answer: "Ausgabe" }],
    [tutorSupportRequestSchema, { code, history: [], action: "skip", ...binding }],
  ] as const;
  it.each(requests)("accepts explicit mode and rejects unknown values", (schema, body) => {
    expect(schema.safeParse(body).success).toBe(true);
    expect(schema.safeParse({ ...body, graphicsMode: "always" }).success).toBe(true);
    expect(schema.safeParse({ ...body, graphicsMode: "sometimes" }).success).toBe(false);
  });
});

describe("bounded generation for the final Tutor question", () => {
  const input = { result, mode: "always" as const, model: "pilot-model", sketchText: code, credential: "private-access-key" };
  it("keeps auto output and call counts unchanged", async () => {
    const provider = providerWith();
    expect(await ensureTutorQuestionGraphic(provider, { ...input, mode: "auto" })).toEqual(result);
    expect(provider.generateGraphic).not.toHaveBeenCalled();
  });
  it("keeps an accepted existing graphic without generating again", async () => {
    const provider = providerWith();
    const actual = await ensureTutorQuestionGraphic(provider, { ...input, result: { ...result, mermaid: diagram } });
    expect(actual).toEqual({ ...result, mermaid: diagram, graphicStatus: "provided" });
    expect(provider.generateGraphic).not.toHaveBeenCalled();
  });
  it("generates only a graphic for the final question using the selected access/model", async () => {
    const provider = providerWith();
    expect(await ensureTutorQuestionGraphic(provider, input)).toEqual({ ...result, mermaid: diagram, graphicStatus: "provided" });
    expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
    const [request, credential] = provider.generateGraphic.mock.calls[0] as unknown as [Record<string, string>, string];
    expect(request.model).toBe("pilot-model");
    expect(request.userPrompt).toContain(question);
    expect(request.userPrompt).toContain(code);
    expect(request.userPrompt).not.toContain(input.credential);
    expect(credential).toBe(input.credential);
  });
  it.each([
    {}, { mermaid: "" }, { mermaid: "flowchart LR\nA --> B\nclick A href https://example.invalid" },
    { mermaid: diagram, question: "Fremde Frage?", answerRating: 1 },
  ])("rejects invalid or extra output without changing the learning result: %j", async (output) => {
    const provider = providerWith(output);
    expect(await ensureTutorQuestionGraphic(provider, input)).toEqual({ ...result, graphicStatus: "unavailable" });
    expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
  });
  it("preserves valid learning content after a provider failure without retry", async () => {
    const provider = providerWith();
    provider.generateGraphic.mockRejectedValue(new TutorProviderError("provider-timeout"));
    expect(await ensureTutorQuestionGraphic(provider, input)).toEqual({ ...result, graphicStatus: "unavailable" });
    expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
  });
  it("propagates cancellation even if the provider returns late", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = { ...providerWith(), generateGraphic: async () => { controller.abort(); return { model: "pilot-model", result: { mermaid: diagram } }; } };
    await expect(ensureTutorQuestionGraphic(provider, { ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("graphics after final Tutor question selection", () => {
  it("asks for a graphic on the initial question while auto keeps its old result", async () => {
    const provider = providerWith();
    const service = new TutorService(provider);
    expect((await service.generateQuestion(code, "key", "pilot-model")).result).not.toHaveProperty("graphicStatus");
    expect(provider.generateGraphic).not.toHaveBeenCalled();
    const response = await service.generateQuestion(code, "key", "pilot-model", 30, undefined, undefined, undefined, "always");
    expect(response.result).toMatchObject({ question, mermaid: diagram, graphicStatus: "provided" });
    expect(provider.generateLearningQuestion.mock.calls[1][0].userPrompt).toContain("Grafikmodus always");
    expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
  });
  it("does not trust a provider's app-owned delivery status", async () => {
    const provider = providerWith();
    provider.generateLearningQuestion.mockResolvedValue({ model: "pilot-model", result: { ...result, graphicStatus: "provided" } } as never);
    const response = await new TutorService(provider).generateQuestion(code, "key", "pilot-model");
    expect(response.result).not.toHaveProperty("graphicStatus");
  });
  it("keeps a weak question open without an extra graphic generation", async () => {
    const provider = providerWith();
    provider.generateLearningQuestion.mockResolvedValue({ model: "pilot-model", result: { ...result, answerRating: 2 } } as never);
    const response = await new TutorService(provider).generateDialogResponse(code, [], question, "Ich weiß es nicht", "key", "pilot-model", 30, undefined, undefined, undefined, { assisted: false }, "always");
    expect(response.retained).toBe(true);
    expect(response.result.question).toBe(question);
    expect(provider.generateGraphic).not.toHaveBeenCalled();
  });
  it("does not add a graphic to the provider-free philosophical fallback", async () => {
    const provider = providerWith();
    await new TutorService(provider).generateDialogResponse(code, [], question, "Wie ist das Wetter morgen?", "key", "pilot-model", 30, undefined, undefined, undefined, { assisted: false }, "always");
    expect(provider.generateGraphic).not.toHaveBeenCalled();
  });
  it("generates the final follow-up while preserving rating and feedback", async () => {
    const provider = providerWith();
    provider.generateLearningQuestion.mockResolvedValue({ model: "pilot-model", result: { question: "Welche Aufgabe hat pinMode in setup?", responseStyle: "normal", answerRating: 5, feedback: "Richtig." } } as never);
    const response = await new TutorService(provider).generateDialogResponse(code, [], question, "Der Ausgang wird HIGH gesetzt.", "key", "pilot-model", 30, undefined, undefined, undefined, { assisted: false }, "always");
    expect(response.result).toMatchObject({ answerRating: 5, feedback: "Richtig.", graphicStatus: "provided", mermaid: diagram });
    expect(provider.generateGraphic.mock.calls[0][0].userPrompt).toContain(response.result.question);
  });
  it("requests a graphic for a skipped-to question", async () => {
    const provider = providerWith();
    const response = await new TutorService(provider).generateNextQuestion({ code, credential: "key", requestedModel: "pilot-model", difficulty: 30, graphicsMode: "always", options: { avoidQuestions: ["Welche Aufgabe hat setup?"] } });
    expect(response.completed).not.toBe(true);
    if (!response.completed) expect(response.result).toMatchObject({ graphicStatus: "provided", mermaid: diagram });
    expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
  });
});

it("records the extra attempt and safe final-question ownership in the existing review", async () => {
  const { randomUUID } = await import("node:crypto");
  const { withTutorDiagnostics, getTutorDiagnostics, getTutorReview } = await import("../../../../server/services/tutor/tutor-diagnostics");
  await withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "question", credential: "private-access-key" }, async () => {
    await new TutorService(providerWith()).generateQuestion(code, "private-access-key", "pilot-model", 30, undefined, undefined, undefined, "always");
    const events = getTutorDiagnostics()!.events;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "content", graphicsMode: "always", graphicAttempt: 1, outcome: "started" }),
      expect.objectContaining({ stage: "content", graphicsMode: "always", graphicAttempt: 1, outcome: "provided" }),
    ]));
    const review = getTutorReview({ id: "test", templateDigest: "a".repeat(64) });
    expect(review!.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "graphic", mode: "always", state: "provided", attempt: 1, question }),
    ]));
    expect(JSON.stringify(review)).not.toContain("private-access-key");
  });
});

async function focusedContent() {
  const { createTutorProgressionState } = await import("../../../../server/services/tutor/curriculum/progression-state");
  const revision = "a".repeat(40);
  return { revision, progressionState: createTutorProgressionState(revision),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleId: "example", exampleTutorAnnotation: { schemaVersion: 2 as const, focus: [{ id: "pin", title: "Pin", objective: "Den Pin verstehen.", questions: [{ kind: "concept" as const, text: "Welche Aufgabe hat pinMode für Pin 13?" }] }] },
  };
}

it("replaces the original graphic and generates only for the teacher's final question with all sketch files", async () => {
  const { CurriculumTutorAdapter } = await import("../../../../server/services/tutor/curriculum-tutor-adapter");
  const provider = providerWith();
  provider.generateLearningQuestion.mockResolvedValue({ model: "pilot-model", result: { ...result, mermaid: "flowchart LR\nX[Alte Frage] --> Y" } } as never);
  const response = await new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(code, "key", "pilot-model", 30, await focusedContent(), undefined, { board: "uno", headers: [{ name: "pins.h", content: "const byte LED=13;" }], entryFile: "dice.ino" }, "always");
  expect(response.result.question).toBe("Welche Aufgabe hat pinMode für Pin 13?");
  expect(response.result.mermaid).toBe(diagram);
  const prompt = provider.generateGraphic.mock.calls[0][0].userPrompt;
  expect(JSON.parse(prompt).question).toBe("Welche Aufgabe hat pinMode für Pin 13?");
  expect(prompt).toContain("pins.h");
  expect(prompt).toContain("const byte LED=13;");
  expect(prompt).toContain("dice.ino");
  expect(prompt).toContain("uno");
  expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
});

it("does not commit a planning transaction when cancellation happens during the extra graphic", async () => {
  const { CurriculumTutorAdapter } = await import("../../../../server/services/tutor/curriculum-tutor-adapter");
  const content = await focusedContent();
  const before = structuredClone(content.progressionState);
  const controller = new AbortController();
  const provider = providerWith();
  provider.generateGraphic.mockImplementation(async () => { controller.abort(); return { model: "pilot-model", result: { mermaid: diagram } }; });
  await expect(new TutorService(provider, new CurriculumTutorAdapter()).generateQuestion(code, "key", "pilot-model", 30, content, controller.signal, undefined, "always")).rejects.toMatchObject({ name: "AbortError" });
  expect(content.progressionState).toEqual(before);
});

it("counts optional graphics as generation calls and enforces the shared evaluation budget", async () => {
  const { CountingProvider } = await import("../../../../server/services/tutor/evaluation/real-provider-evaluation");
  const provider = providerWith();
  const counted = new CountingProvider(provider, 2);
  await counted.generateLearningQuestion({ model: "pilot-model", systemPrompt: "", userPrompt: "" }, "key");
  await counted.generateGraphic({ model: "pilot-model", systemPrompt: "", userPrompt: "" }, "key");
  expect(counted.counts).toEqual({ total: 2, modelListCalls: 0, generationCalls: 2, judgeCalls: 0 });
  await expect(counted.generateGraphic({ model: "pilot-model", systemPrompt: "", userPrompt: "" }, "key")).rejects.toThrow();
  expect(provider.generateGraphic).toHaveBeenCalledTimes(1);
});

it("uses the real KI:connect adapter for graphic-only JSON without parsing it as a new learning question", async () => {
  const { KiconnectProvider } = await import("../../../../server/services/tutor/kiconnect-provider");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ model: "pilot-model", choices: [{ message: { content: JSON.stringify({ mermaid: diagram }) } }] })));
  try {
    const response = await new KiconnectProvider().generateGraphic({ model: "pilot-model", systemPrompt: "Only graphic", userPrompt: question }, "key");
    expect(response).toEqual({ model: "pilot-model", result: { mermaid: diagram } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(payload.model).toBe("pilot-model");
  } finally { fetchMock.mockRestore(); }
});

it.each(["chosen-alias", undefined])("keeps the callable selected model for graphic generation even when the returned name differs (%s)", async (selection) => {
  const { KiconnectProvider } = await import("../../../../server/services/tutor/kiconnect-provider");
  const { config } = await import("../../../../server/config");
  const previous = config.tutor.autoModels;
  (config.tutor as { autoModels: readonly string[] }).autoModels = ["chosen-alias"];
  const sent: string[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "chosen-alias" }] }));
    const body = JSON.parse(String(init?.body));
    sent.push(body.model);
    if (body.model !== "chosen-alias") return new Response("{}", { status: 404 });
    const graphic = body.messages[0].content.includes("Erzeuge ausschließlich ein JSON-Objekt");
    return new Response(JSON.stringify({ model: "actual-version-202611", choices: [{ message: { content: JSON.stringify(graphic ? { mermaid: diagram } : result) } }] }));
  });
  try {
    const response = await new TutorService(new KiconnectProvider()).generateQuestion(code, "key", selection, 30, undefined, undefined, undefined, "always");
    expect(sent).toEqual(["chosen-alias", "chosen-alias"]);
    expect(response.model).toBe("actual-version-202611");
    expect(response.result.graphicStatus).toBe("provided");
  } finally { fetchMock.mockRestore(); (config.tutor as { autoModels: readonly string[] }).autoModels = previous; }
});

it("does not ask for a graphic when a skip completes without a next question", async () => {
  const provider = providerWith();
  const service = new TutorService(provider, {
    async planInitial() { return { kind: "blocked", progressionBlockedReason: "content-exhausted", contentRevision: "a".repeat(40), learningPhase: "LEARN", masteredTopicIds: [], strategyId: "built-in-default", strategySource: "built-in" }; },
    async planFollowup() { return null; },
  });
  const response = await service.generateNextQuestion({ code, credential: "key", requestedModel: "pilot-model", difficulty: 30, graphicsMode: "always", options: {} });
  expect(response.completed).toBe(true);
  expect(provider.generateLearningQuestion).not.toHaveBeenCalled();
  expect(provider.generateGraphic).not.toHaveBeenCalled();
});

it.each(["answer", "skip"])("does not commit when the graphic of a new %s is cancelled", async (kind) => {
  const { CurriculumTutorAdapter } = await import("../../../../server/services/tutor/curriculum-tutor-adapter");
  const content = await focusedContent();
  content.exampleTutorAnnotation.focus[0].questions.push({ kind: "concept", text: "Welche Wirkung hat digitalWrite in loop?" });
  const controller = new AbortController();
  const provider = providerWith();
  const service = new TutorService(provider, new CurriculumTutorAdapter());
  const first = await service.generateQuestion(code, "key", "pilot-model", 30, content);
  const before = structuredClone(content.progressionState);
  provider.generateLearningQuestion.mockResolvedValue({ model: "pilot-model", result: { question: "Welche Wirkung hat digitalWrite in loop?", feedback: "Richtig.", answerRating: 5, responseStyle: "normal" } } as never);
  provider.generateGraphic.mockImplementation(async () => { controller.abort(); return { model: "pilot-model", result: { mermaid: diagram } }; });
  const response = kind === "answer"
    ? service.generateDialogResponse(code, [], first.result.question, "pinMode stellt den Pin als Ausgang ein.", "key", "pilot-model", 30, content, controller.signal, undefined, { assisted: false }, "always")
    : service.generateNextQuestion({ code, credential: "key", requestedModel: "pilot-model", difficulty: 30, courseContent: content, signal: controller.signal, graphicsMode: "always", options: { leave: { question: first.result.question, history: [] }, avoidQuestions: [first.result.question] } });
  await expect(response).rejects.toMatchObject({ name: "AbortError" });
  expect(content.progressionState).toEqual(before);
});

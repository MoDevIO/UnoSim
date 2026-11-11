import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import { tutorSupportResponseSchema } from "@shared/tutor-support";
import { TUTOR_REVIEW_LIMITS, tutorReviewExportSchema, type TutorReviewServerEntry } from "@shared/tutor-review";
import { TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import { bindTutorDiagnosticResponse, reportTutorGraphic, reportTutorReviewAction, tutorDiagnosticFetch, tutorRequestTrace } from "@/lib/tutor-diagnostics";
import { clearTutorReview } from "@/lib/tutor-diagnostic-runtime";
import { buildTutorReviewExport } from "@/lib/tutor-review-export";
import { setTutorReviewCaptureEnabled, startNewTutorReviewRun, tutorReviewRuns } from "@/lib/tutor-review-store";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * The Tutor review capture (LearningQuestions 12.7) through the real browser runtime: requests as use-tutor
 * sends them, responses as the server delivers them, and the one-click export.
 */
const KEY = "sk-PRIVATE-REVIEW-KEY-0123456789";
const SKETCH = { code: "int counter = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { counter++; }", board: "uno" };
const SUPPORT = {
  session: "11111111-1111-4111-8111-111111111111", questionHandle: "22222222-2222-4222-8222-222222222222",
  answerAttempts: 1, clarifications: 0, canRevealReference: false, canSkip: false, referenceAvailable: false, referenceShown: false, outcome: "open",
};

type Reply = {
  readonly status?: number;
  readonly body: Record<string, unknown>;
  readonly review?: (ids: { traceId: string; requestId: string; operation: string }) => unknown;
  /** The server's technical diagnostics for this request, as the routes attach them. */
  readonly diagnostics?: (ids: { traceId: string; requestId: string; operation: string }) => unknown;
  /** Holds the response until released, after the request has started. */
  readonly gate?: { started: () => void; release: Promise<void> };
};

function gated() {
  let started!: () => void;
  let release!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  return { gate: { started, release: releasePromise }, whenStarted: startedPromise, release };
}
let replies: Reply[] = [];

function envelope(entries: TutorReviewServerEntry[], extra: Record<string, unknown> = {}) {
  return (ids: { traceId: string; requestId: string; operation: string }) => ({
    version: 1, ...ids, promptRevision: { id: "tutor-prompts-v10", templateDigest: "a".repeat(64) },
    guidanceRevision: "assessment-guidance-v1", guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE },
    entries, dropped: 0, sanitized: 0, ...extra,
  });
}

beforeEach(() => {
  localStorage.setItem("unoDebugMode", "1");
  clearTutorReview();
  replies = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${url}`);
    if (reply.gate) { reply.gate.started(); await reply.gate.release; }
    const headers = new Headers(init?.headers);
    const operation = url.endsWith("/dialog") ? "answer" : url.endsWith("/support") ? "support" : "question";
    const ids = { traceId: headers.get("x-unosim-tutor-trace-id") ?? "", requestId: headers.get("x-request-id") ?? "", operation };
    const extra = { ...(reply.review ? { review: reply.review(ids) } : {}), ...(reply.diagnostics ? { diagnostics: reply.diagnostics(ids) } : {}) };
    return new Response(JSON.stringify({ ...reply.body, ...extra }), { status: reply.status ?? 200 });
  });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

const tutorBody = (fields: Record<string, unknown>) => ({ provider: "kiconnect", model: "gpt-5.5-2026-08-07", responseStyle: "normal", ...fields });

async function send(path: string, body: Record<string, unknown>, reply: Reply, options: { signal?: AbortSignal; traceId?: string } = {}) {
  replies.push(reply);
  const response = await tutorDiagnosticFetch(path, { method: "POST", body: JSON.stringify({ credential: KEY, ...body }), ...(options.signal ? { signal: options.signal } : {}) }, { traceId: options.traceId });
  const payload: unknown = await response.json();
  if (!response.ok) return { payload, parsed: undefined };
  const schema = path.endsWith("/support") ? tutorSupportResponseSchema : tutorResponseSchema;
  const parsed = schema.parse(payload);
  bindTutorDiagnosticResponse(payload, parsed);
  return { payload, parsed };
}

const exportNow = () => buildTutorReviewExport(tutorReviewRuns().at(-1)!);
const recordOf = (text: string) => tutorReviewExportSchema.parse(parseTutorReviewExportJson(text));

describe("Tutor review capture", () => {
  it("keeps more than eight answers in one copy and binds each rating to the question it answered", async () => {
    let asked = "Welche Aufgabe hat counter?";
    await send("/api/tutor/question", { ...SKETCH, difficulty: 30 }, { body: tutorBody({ question: asked }) });
    const history: Array<Record<string, unknown>> = [];
    for (let turn = 1; turn <= 10; turn++) {
      const next = `Frage ${turn + 1}: Was passiert in Durchlauf ${turn}?`;
      await send("/api/tutor/dialog", { ...SKETCH, question: asked, answer: `Antwort ${turn}`, history: history.slice(-8), difficulty: 30 }, {
        body: tutorBody({ question: next, feedback: `Feedback ${turn}`, answerRating: (turn % 5) + 1, learnerInput: "answer", questionStatus: "closed" }),
      });
      history.push({ question: asked, answer: `Antwort ${turn}`, feedback: `Feedback ${turn}`, answerRating: (turn % 5) + 1, responseStyle: "normal" });
      asked = next;
    }
    const exported = exportNow();
    const record = recordOf(exported.text);
    const answers = record.steps.filter((step) => step.kind === "answer");
    expect(answers).toHaveLength(10);
    expect(answers[9].request?.askedQuestion).toBe("Frage 10: Was passiert in Durchlauf 9?");
    expect(answers[9].request?.answer).toBe("Antwort 10");
    expect(answers[9].response?.answerRating).toBe((10 % 5) + 1);
    expect(answers[9].response?.question).toBe("Frage 11: Was passiert in Durchlauf 10?");
    // The sent eight-entry history points to the recorded steps, not to copies.
    expect(answers[9].request?.history).toHaveLength(8);
    expect(answers[9].request?.history.every((ref) => "stepId" in ref)).toBe(true);
    expect(record.importedHistory).toHaveLength(0);
    expect(record.contexts).toHaveLength(1);
    expect(exported.text).toContain("Antwort 1");
    expect(exported.text.indexOf("== Protokoll ==")).toBeLessThan(exported.text.indexOf("== Codekontexte"));
    expect(exported.text.indexOf("== Codekontexte")).toBeLessThan(exported.text.indexOf("== Legende =="));
    expect(exported.text.indexOf("== Legende ==")).toBeLessThan(exported.text.indexOf("== JSON =="));
    expect(exported.text.trimEnd().endsWith(`=== ENDE UnoSim Tutor-Review v1 · runId ${record.runId} ===`)).toBe(true);
  });

  it("references the code each request actually sent, also after sketch, header and board changes", async () => {
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Erste?" }) });
    await send("/api/tutor/question", { ...SKETCH, code: `${SKETCH.code}\n// geändert` }, { body: tutorBody({ question: "Zweite?" }) });
    await send("/api/tutor/question", { ...SKETCH, headers: [{ name: "pins.h", content: "#define LED 13" }], entryFile: "main.ino" }, { body: tutorBody({ question: "Dritte?" }) });
    await send("/api/tutor/question", { ...SKETCH, board: "mega2560" }, { body: tutorBody({ question: "Vierte?" }) });
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Fünfte?" }) });
    const record = recordOf(exportNow().text);
    expect(record.contexts).toHaveLength(4);
    const contextOf = (index: number) => record.contexts.find((context) => context.contextId === record.steps[index].contextId)!;
    expect(contextOf(1).code).toContain("// geändert");
    expect(contextOf(2).headers).toEqual([{ name: "pins.h", content: "#define LED 13" }]);
    expect(contextOf(2).entryFile).toBe("main.ino");
    expect(contextOf(3).board).toBe("mega2560");
    expect(record.steps[4].contextId).toBe(record.steps[0].contextId);
  });

  it("records objections, their classification and rating as delivered, with the sketch to check a Serial claim", async () => {
    const objections = ['"in der betrachteten Variable" -> was soll das sein?', "diese frage hatten wir schon!", "sag mir welcher datentyp und welche variable du meinst!"];
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Welchen Wert gibt Serial.println in der betrachteten Variable aus?" }) });
    await send("/api/tutor/dialog", { ...SKETCH, question: "Welchen Wert gibt Serial.println in der betrachteten Variable aus?", answer: objections[0], history: [] }, {
      body: tutorBody({ question: "Welchen Wert gibt Serial.println in der betrachteten Variable aus?", feedback: "Gemeint ist counter.", learnerInput: "clarification" }),
    });
    await send("/api/tutor/dialog", { ...SKETCH, question: "Welchen Wert gibt Serial.println in der betrachteten Variable aus?", answer: objections[1], history: [] }, {
      body: tutorBody({ question: "Was gibt Serial.println aus?", feedback: "Die Ausgabe zeigt 3.", answerRating: 2, learnerInput: "answer", questionStatus: "closed" }),
    });
    await send("/api/tutor/dialog", { ...SKETCH, question: "Was gibt Serial.println aus?", answer: objections[2], history: [] }, {
      body: tutorBody({ question: "Was gibt Serial.println aus?", feedback: "Hilfe", learnerInput: "help" }),
    });
    const { text } = exportNow();
    const record = recordOf(text);
    const answers = record.steps.filter((step) => step.kind === "answer");
    expect(answers.map((step) => step.request?.answer)).toEqual(objections);
    expect(answers.map((step) => step.response?.learnerInput)).toEqual(["clarification", "answer", "help"]);
    // A wrongly rated objection stays visible as delivered; the capture does not correct it.
    expect(answers[1].response?.answerRating).toBe(2);
    expect(text).toContain("Bewertung: keine (Eingabe als clarification eingestuft)");
    expect(text).toContain("Die Ausgabe zeigt 3.");
    // The sketch has no active Serial.println: the export alone shows it.
    expect(record.contexts[0].code).not.toContain("Serial.println");
    expect(text).toContain("Serial.begin(9600)");
  });

  it("correlates a graphic draft, the replacing planner question and the discarded graphic", async () => {
    const mermaid = "flowchart LR\n  A[setup] --> B[loop]";
    await send("/api/tutor/question", { ...SKETCH }, {
      body: tutorBody({ question: "Planerfrage zu loop?" }),
      review: envelope([
        { kind: "facts", json: '{"board":{"name":"Uno"}}' },
        { kind: "draft", attempt: 1, responseStyle: "normal", question: "Modellfrage mit Grafik?", mermaid },
        { kind: "decision", trigger: "planner-question", before: "Modellfrage mit Grafik?", after: "Planerfrage zu loop?" },
        { kind: "outcome", followUpSource: "planner", question: "Planerfrage zu loop?", graphic: "discarded" },
      ]),
    });
    const { text } = exportNow();
    const record = recordOf(text);
    const server = record.steps[0].server!;
    expect(server.status).toBe("received");
    expect(server.promptRevision?.id).toBe("tutor-prompts-v10");
    expect(server.entries.find((entry) => entry.kind === "draft")).toMatchObject({ question: "Modellfrage mit Grafik?", mermaid });
    expect(text).toContain("Entscheidung: planner-question");
    expect(text).toContain("Grafik: Server: discarded; Entwurf enthielt eine Grafik");
    expect(text).toContain("  | flowchart LR");
    expect(record.legend.confirmation).toBe("confirmed-by-server");
  });

  it("captures clarification, hint, a shown reference and a skip without handles or idempotency keys", async () => {
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Was zählt counter?", support: SUPPORT }) });
    const binding = { supportSession: SUPPORT.session, questionHandle: SUPPORT.questionHandle, actionId: "33333333-3333-4333-8333-333333333333", courseContentSession: "44444444-4444-4444-8444-444444444444" };
    await send("/api/tutor/support", { ...SKETCH, action: "clarify", ...binding }, { body: { action: "clarify", explanation: "Gemeint ist die Variable counter.", support: SUPPORT, provider: "kiconnect", model: "m" } });
    await send("/api/tutor/support", { ...SKETCH, action: "hint", ...binding }, { body: { action: "hint", explanation: "Schau in loop.", support: SUPPORT, provider: "kiconnect", model: "m" } });
    await send("/api/tutor/support", { ...SKETCH, action: "reveal", ...binding }, {
      body: { action: "reveal", reference: { status: "available", answer: "Die Durchläufe", explanation: "counter++ in loop" }, support: { ...SUPPORT, referenceShown: true }, provider: "kiconnect", model: "m" },
    });
    // The skip's next question carries a graphic and learning metadata; no server review is attached.
    const next = { question: "Nächste Frage?", responseStyle: "normal", mermaid: "flowchart LR\n  S[skip] --> N[next]", difficulty: 40, topic: "Zähler", topicId: "counter", strategyId: "trace-loop" };
    await send("/api/tutor/support", { ...SKETCH, action: "skip", ...binding }, { body: { action: "skip", next, provider: "kiconnect", model: "m" } });
    const { text } = exportNow();
    const record = recordOf(text);
    expect(record.steps.map((step) => step.request?.action)).toEqual([undefined, "clarify", "hint", "reveal", "skip"]);
    expect(record.steps[3].response?.reference).toMatchObject({ status: "available", answer: "Die Durchläufe" });
    expect(record.steps[4].response?.next).toEqual({
      question: "Nächste Frage?", mermaid: next.mermaid, difficulty: 40, topic: "Zähler", learning: { topicId: "counter", strategyId: "trace-loop" },
    });
    expect(text).toContain("Nächste Frage: Mermaid (ausgeliefert):");
    expect(text).toContain("  | flowchart LR");
    expect(text).toContain("Nächste Frage: Lernkontext: topicId=counter, strategyId=trace-loop");
    expect(record.steps[1].request?.continuesCourseSession).toBe(true);
    for (const secret of [SUPPORT.session, SUPPORT.questionHandle, binding.actionId, binding.courseContentSession, KEY]) expect(text).not.toContain(secret);
  });

  it("counts a retry as another attempt of the same action and marks an abort", async () => {
    const first = new AbortController();
    await send("/api/tutor/question", { ...SKETCH }, { status: 503, body: { error: { code: "PROVIDER_UNAVAILABLE", message: `secret ${KEY}` } } }, { signal: first.signal });
    const traceId = tutorRequestTrace(first.signal);
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Zweiter Versuch?" }) }, { traceId });
    const aborted = new AbortController();
    replies.push({ body: tutorBody({ question: "Nie angezeigt?" }) });
    const pending = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }), signal: aborted.signal });
    aborted.abort();
    await pending.then((response) => response.json()).catch(() => undefined);
    const { text } = exportNow();
    const record = recordOf(text);
    expect(record.steps[0]).toMatchObject({ status: "failed", failure: { httpStatus: 503, code: "PROVIDER_UNAVAILABLE" } });
    expect(record.steps[1]).toMatchObject({ attempt: 2, relatesTo: record.steps[0].stepId, status: "completed" });
    expect(record.steps[2].status).toBe("aborted");
    expect(record.capture.incompleteReasons).toContain("request-aborted");
    expect(text).not.toContain(KEY);
  });

  it("keeps learning content and names missing or invalid server evidence", async () => {
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Ohne Serverdaten?" }) });
    const invalid = await send("/api/tutor/question", { ...SKETCH }, {
      body: tutorBody({ question: "Mit fremdem Block?" }),
      review: (ids) => envelope([{ kind: "draft", attempt: 1, question: "Fremd" }])({ ...ids, requestId: crypto.randomUUID() }),
    });
    expect(invalid.parsed?.question).toBe("Mit fremdem Block?");
    expect(invalid.payload).not.toHaveProperty("review");
    const record = recordOf(exportNow().text);
    expect(record.steps[0].server?.status).toBe("unavailable");
    expect(record.steps[1].server?.status).toBe("invalid");
    expect(JSON.stringify(record)).not.toContain('"Fremd"');
    expect(record.capture.incompleteReasons).toEqual(expect.arrayContaining(["server-review-unavailable", "review-invalid"]));
    expect(record.legend.confirmation).toBe("client-only");
  });

  it("redacts the credential in every spelling before storing and keeps hostile text inert", async () => {
    const hostile = "<img src=x onerror=alert(1)> ```js\n## Fake heading\n== JSON ==\u0007\u2028";
    await send("/api/tutor/question", { ...SKETCH, code: `// key ${KEY}\n${SKETCH.code}` }, {
      body: tutorBody({ question: `Wiederholt der Tutor ${KEY}?`, feedback: `JSON ${JSON.stringify(KEY).slice(1, -1)} url ${encodeURIComponent(KEY)} ${hostile}` }),
      review: envelope([{ kind: "draft", attempt: 1, question: `draft ${KEY}` }]),
    });
    const run = tutorReviewRuns().at(-1)!;
    expect(JSON.stringify(run.steps) + JSON.stringify(run.contexts)).not.toContain(KEY);
    expect(run.sanitized).toBeGreaterThanOrEqual(4);
    const { text } = exportNow();
    expect(text).not.toContain(KEY);
    expect(text).toContain("[REDACTED-CREDENTIAL]");
    expect(text).toContain("⟦U+0007⟧");
    expect(text).toContain("⟦U+2028⟧");
    // The hostile line stays a prefixed content line and cannot open a section of its own.
    expect(text.split("\n").filter((textLine) => textLine === "== JSON ==")).toHaveLength(1);
    expect(recordOf(text).steps[0].response?.feedback).toContain("<img src=x onerror=alert(1)>");
  });

  it("stops at DEBUG off, starts a new run after DEBUG on, and clearing loses every earlier run", async () => {
    const lateGate = gated();
    replies.push({ body: tutorBody({ question: "Spät?" }), gate: lateGate.gate });
    const late = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }) });
    await lateGate.whenStarted;
    setTutorReviewCaptureEnabled(false);
    lateGate.release();
    await (await late).json();
    expect(tutorReviewRuns().at(-1)?.status).toBe("stopped");
    expect(tutorReviewRuns().at(-1)?.steps[0].response).toBeUndefined();
    setTutorReviewCaptureEnabled(true);
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Neu?" }) });
    expect(tutorReviewRuns()).toHaveLength(2);
    const clearGate = gated();
    replies.push({ body: tutorBody({ question: "Vor dem Leeren gestartet?" }), gate: clearGate.gate });
    const beforeClear = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }) });
    await clearGate.whenStarted;
    clearTutorReview();
    clearGate.release();
    await (await beforeClear).json();
    expect(tutorReviewRuns()).toHaveLength(0);
  });

  it("records held and displayed steps and keeps an export stable while later responses arrive", async () => {
    const { payload, parsed } = await send("/api/tutor/dialog", { ...SKETCH, question: "Alt?", answer: "Antwort", history: [{ question: "Vorher?", answer: "Vorher-Antwort", responseStyle: "normal" }] }, {
      body: tutorBody({ question: "Neu?", answerRating: 5, learnerInput: "answer", questionStatus: "closed" }),
    });
    expect(payload).toBeDefined();
    reportTutorReviewAction(parsed!, "held");
    const snapshot = exportNow();
    reportTutorReviewAction(parsed!, "displayed");
    const record = recordOf(snapshot.text);
    expect(record.steps.map((step) => step.kind)).toEqual(["answer", "held"]);
    expect(record.steps[1].relatesTo).toBe(record.steps[0].stepId);
    expect(snapshot.bytes).toBe(new TextEncoder().encode(snapshot.text).length);
    expect(snapshot.text).toContain(`Größe: ${(snapshot.bytes / 1024).toFixed(1)} KiB`);
    // History from before the run is imported once and makes the run incomplete, not invented steps.
    expect(record.importedHistory).toHaveLength(1);
    expect(record.capture.incompleteReasons).toContain("capture-started-late");
    expect(recordOf(exportNow().text).steps.map((step) => step.kind)).toEqual(["answer", "held", "displayed"]);
  });

  it("exports the legend from the Tutor's own rule texts and fails visibly when the end is cut off", async () => {
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Legende?" }) });
    const { text } = exportNow();
    expect(text).toContain(TUTOR_RATING_RUBRIC.slice(0, 40));
    expect(recordOf(text).legend.ratingRubric).toBe(TUTOR_RATING_RUBRIC);
    expect(() => parseTutorReviewExportJson(text.slice(0, Math.floor(text.length * 0.8)))).toThrow(/incomplete/);
  });
});

describe("Tutor review revisions and running requests", () => {
  it("names the prompt revision per request and marks a legend the server does not confirm", async () => {
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Erste?" }), review: envelope([]) });
    await send("/api/tutor/question", { ...SKETCH }, {
      body: tutorBody({ question: "Zweite?" }),
      review: (ids) => ({
        ...envelope([])(ids), promptRevision: { id: "tutor-prompts-v11", templateDigest: "b".repeat(64) }, guidanceRevision: "assessment-guidance-v2",
        guidance: { ratingRubric: "Rubrik v2: 1 falsch … 5 vollständig.", difficultyGuidance: "Schwierigkeit v2: 1–100 nach Transfer." },
      }),
    });
    await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Dritte?" }) });
    const { text } = exportNow();
    const record = recordOf(text);
    expect(record.steps.map((step) => step.server?.promptRevision?.id)).toEqual(["tutor-prompts-v10", "tutor-prompts-v11", undefined]);
    expect(record.legend.confirmation).toBe("differs-from-server");
    // The v2 texts themselves are kept, not only their name; the step names the set it was rated with.
    expect(record.legend.serverSets).toEqual([{ guidanceRevision: "assessment-guidance-v2", ratingRubric: "Rubrik v2: 1 falsch … 5 vollständig.", difficultyGuidance: "Schwierigkeit v2: 1–100 nach Transfer." }]);
    expect(record.steps[1].server?.guidanceRevision).toBe("assessment-guidance-v2");
    expect(text).toContain("Regeln assessment-guidance-v2");
    expect(text).toContain("Abweichender Regelstand des Servers assessment-guidance-v2");
    expect(text).toContain("  | Rubrik v2: 1 falsch … 5 vollständig.");
    expect(text).toContain("Server meldet einen anderen Regelstand");
    // Without server data the rules of that request are unknown, said at the request itself.
    expect(text).toContain("Bewertungsregeln dieses Requests unbekannt");
  });

  it("exports a running request as open and the same text, size and counts it describes", async () => {
    const running = gated();
    replies.push({ body: tutorBody({ question: "Läuft?" }), gate: running.gate });
    const pending = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }) });
    await running.whenStarted;
    const during = exportNow();
    running.release();
    const payload: unknown = await (await pending).json();
    bindTutorDiagnosticResponse(payload, tutorResponseSchema.parse(payload));
    const record = recordOf(during.text);
    expect(record.capture.openSteps).toBe(1);
    expect(record.steps[0].status).toBe("open");
    expect(during.text).toContain("offen (noch keine Antwort)");
    expect(during.bytes).toBe(new TextEncoder().encode(during.text).length);
    expect(recordOf(exportNow().text).capture.openSteps).toBe(0);
  });
});

describe("Tutor review limits", () => {
  it("stops a run at 100 request attempts and counts what it no longer records", async () => {
    for (let index = 0; index < TUTOR_REVIEW_LIMITS.requestAttempts + 2; index++) {
      await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: `Frage ${index}?` }) });
    }
    const run = tutorReviewRuns().at(-1)!;
    expect(run.requestAttempts).toBe(100);
    expect(run.status).toBe("stopped");
    expect(run.stoppedReason).toBe("capture-limit");
    expect(run.notCaptured).toBe(2);
    expect(recordOf(exportNow().text).steps.filter((step) => step.kind === "question")).toHaveLength(100);
  });

  it("stops at the 17th distinct code state without a half-recorded step", async () => {
    for (let index = 0; index < 17; index++) {
      await send("/api/tutor/question", { ...SKETCH, code: `${SKETCH.code}\n// Stand ${index}` }, { body: tutorBody({ question: `Stand ${index}?` }) });
    }
    const record = recordOf(exportNow().text);
    expect(record.contexts).toHaveLength(16);
    expect(record.steps).toHaveLength(16);
    expect(record.steps.every((step) => record.contexts.some((context) => context.contextId === step.contextId))).toBe(true);
    expect(record.capture.stoppedReason).toBe("capture-limit");
  });

  it("records a maximal multi-file sketch completely and keeps the export within its budget", async () => {
    const headers = Array.from({ length: 20 }, (_, index) => ({ name: `datei${index}.h`, content: `// ${index} ä€\n${"x".repeat(32 * 1024 - 20)}` }));
    const code = `// sketch ä€\n${"y".repeat(128 * 1024 - 20)}`;
    await send("/api/tutor/question", { code, headers, board: "uno" }, { body: tutorBody({ question: "Großer Sketch?" }) });
    const exported = exportNow();
    const record = recordOf(exported.text);
    expect(record.contexts[0].headers).toHaveLength(20);
    expect(record.contexts[0].code).toBe(code);
    expect(exported.bytes).toBeLessThan(TUTOR_REVIEW_LIMITS.runBytes);
    expect(tutorReviewRuns().at(-1)!.estimatedBytes).toBeGreaterThanOrEqual(exported.bytes);
  });

  it("keeps at most three runs and names the removed one", async () => {
    for (let index = 0; index < 4; index++) {
      await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: `Lauf ${index}?` }) });
      startNewTutorReviewRun();
    }
    expect(tutorReviewRuns()).toHaveLength(3);
    expect(tutorReviewRuns()[0].steps[0].response?.question).toBe("Lauf 1?");
  });
});

describe("Tutor review after clearing", () => {
  it("drops the credential of a request that answers after clearing and keeps no dangling local step", async () => {
    const gate = gated();
    replies.push({ body: tutorBody({ question: "Nach dem Leeren?" }), gate: gate.gate });
    const pending = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }) });
    await gate.whenStarted;
    clearTutorReview();
    gate.release();
    const payload: unknown = await (await pending).json();
    const question = tutorResponseSchema.parse(payload);
    bindTutorDiagnosticResponse(payload, question);
    reportTutorReviewAction(question, "displayed");
    expect(tutorReviewRuns()).toHaveLength(0);
  });
});

describe("technical events of an ended capture epoch", () => {
  const serverEvents = (ids: { traceId: string; requestId: string; operation: string }) => ({
    version: 1, traceId: ids.traceId, requestId: ids.requestId, truncated: 0,
    events: [{ version: 1, ...ids, sequence: 1, timestamp: new Date().toISOString(), origin: "service", stage: "request", outcome: "completed" }],
  });

  for (const [name, end] of [
    ["Clear", () => clearTutorReview()],
    ["DEBUG off and on", () => {
      document.dispatchEvent(new CustomEvent("debugModeChange", { detail: { value: false } }));
      document.dispatchEvent(new CustomEvent("debugModeChange", { detail: { value: true } }));
    }],
  ] as const) {
    it(`does not dispatch events of a request started before ${name}`, async () => {
      const running = gated();
      replies.push({ body: tutorBody({ question: "Alt?", mermaid: "flowchart LR\n  A --> B" }), gate: running.gate, diagnostics: serverEvents });
      const pending = tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, ...SKETCH }) });
      await running.whenStarted;
      end();
      // From here on the technical Debug list must not receive anything of the old request.
      const seen: unknown[] = [];
      const listener = (event: Event) => seen.push((event as CustomEvent).detail);
      document.addEventListener("tutor-diagnostic", listener);
      try {
        running.release();
        const payload: unknown = await (await pending).json();
        const parsed = tutorResponseSchema.parse(payload);
        bindTutorDiagnosticResponse(payload, parsed);
        reportTutorGraphic(parsed, { stage: "renderer", outcome: "rendered" });
      } finally {
        document.removeEventListener("tutor-diagnostic", listener);
      }
      expect(seen).toEqual([]);
      // Clear removes the old run; DEBUG off keeps it stopped. Either way the old step gains no content or events.
      for (const step of tutorReviewRuns().flatMap((run) => run.steps)) {
        expect(step.response).toBeUndefined();
        expect(step.events.filter((event) => event.outcome !== "started")).toEqual([]);
      }
    });
  }

  it("still dispatches the events of a request started after Clear", async () => {
    clearTutorReview();
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    document.addEventListener("tutor-diagnostic", listener);
    try {
      await send("/api/tutor/question", { ...SKETCH }, { body: tutorBody({ question: "Neu?" }), diagnostics: serverEvents });
    } finally {
      document.removeEventListener("tutor-diagnostic", listener);
    }
    expect(seen.map((event) => `${(event as { origin: string }).origin}/${(event as { outcome: string }).outcome}`))
      .toEqual(expect.arrayContaining(["frontend/started", "service/completed", "frontend/received", "frontend/completed"]));
  });
});

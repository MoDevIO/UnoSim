import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import { tutorSupportResponseSchema } from "@shared/tutor-support";
import { TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import { TUTOR_REVIEW_REDACTED, tutorReviewExportSchema, type TutorReviewServerEntry } from "@shared/tutor-review";
import { getTutorReview, reportTutorReview, withTutorDiagnostics } from "../../server/services/tutor/tutor-diagnostics";
import { bindTutorDiagnosticResponse, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";
import { clearTutorReview } from "@/lib/tutor-diagnostic-runtime";
import { buildTutorReviewExport } from "@/lib/tutor-review-export";
import {
  beginTutorReviewRequest, clearTutorReviewRuns, completeTutorReviewStep, receiveTutorReviewResponse, tutorReviewRuns,
} from "@/lib/tutor-review-store";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * Redaction keeps the structure of the Tutor review (LearningQuestions 12.7): free content is redacted, while
 * fixed public codes, checked against their enumerations first, keep their meaning even when a credential
 * happens to spell one of them.
 */
const PROMPT = { id: "tutor-prompts-v10", templateDigest: "a".repeat(64) };
const exported = () => {
  const { text } = buildTutorReviewExport(tutorReviewRuns().at(-1)!);
  return tutorReviewExportSchema.parse(parseTutorReviewExportJson(text));
};

describe("collector, JSON, browser runtime and export with the key `answer`", () => {
  let serverEntries: TutorReviewServerEntry[] = [];
  let responseBody: Record<string, unknown> = {};

  beforeEach(() => {
    localStorage.setItem("unoDebugMode", "1");
    clearTutorReview();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const review = withTutorDiagnostics({
        traceId: headers.get("x-unosim-tutor-trace-id")!, requestId: headers.get("x-request-id")!,
        operation: url.endsWith("/dialog") ? "answer" : "question", credential: JSON.parse(String(init?.body)).credential,
      }, () => {
        for (const entry of serverEntries) reportTutorReview(entry);
        return getTutorReview(PROMPT);
      });
      return new Response(JSON.stringify({ ...responseBody, review }), { status: 200 });
    });
  });
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); clearTutorReview(); });

  it("keeps the classification and every server code, and still redacts the key in free content", async () => {
    const key = "answer";
    serverEntries = [
      { kind: "classification", learnerInput: "answer" },
      { kind: "draft", attempt: 1, responseStyle: "normal", question: "Is the answer in loop?", feedback: "Your answer is close." },
      { kind: "decision", trigger: "planner-question", before: "Old answer?", after: "New question?" },
      { kind: "outcome", followUpSource: "provider", question: "New question?", graphic: "kept" },
    ];
    responseBody = {
      provider: "kiconnect", model: "m", responseStyle: "normal", question: "New question?", feedback: "Your answer is close.",
      answerRating: 4, learnerInput: "answer", questionStatus: "closed",
    };
    const response = await tutorDiagnosticFetch("/api/tutor/dialog", {
      method: "POST", body: JSON.stringify({ code: "void loop() {}", credential: key, question: "Old answer?", answer: "my answer", history: [] }),
    });
    const payload: unknown = await response.json();
    bindTutorDiagnosticResponse(payload, tutorResponseSchema.parse(payload));

    const step = exported().steps[0];
    expect(step.server?.dropped).toBe(0);
    const entries = step.server!.entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["classification", "draft", "decision", "outcome"]);
    expect(entries[0]).toEqual({ kind: "classification", learnerInput: "answer" });
    expect(entries[1]).toMatchObject({ responseStyle: "normal", question: `Is the ${TUTOR_REVIEW_REDACTED} in loop?`, feedback: `Your ${TUTOR_REVIEW_REDACTED} is close.` });
    expect(entries[2]).toMatchObject({ trigger: "planner-question", before: `Old ${TUTOR_REVIEW_REDACTED}?` });
    expect(entries[3]).toMatchObject({ followUpSource: "provider", graphic: "kept" });
    expect(step.response).toMatchObject({ learnerInput: "answer", questionStatus: "closed", responseStyle: "normal", feedback: `Your ${TUTOR_REVIEW_REDACTED} is close.` });
    expect(step.request?.answer).toBe(`my ${TUTOR_REVIEW_REDACTED}`);
  });
});

describe("local capture without a server review", () => {
  beforeEach(() => clearTutorReviewRuns());
  afterEach(() => clearTutorReviewRuns());

  function record(endpoint: "question" | "dialog" | "support", credential: string, body: Record<string, unknown>, response: Record<string, unknown>) {
    const ids = { traceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const handle = beginTutorReviewRequest({ ...ids, endpoint, body: JSON.stringify({ code: "void loop() {}", credential, ...body }) });
    receiveTutorReviewResponse(handle, { ok: true, body: response, review: undefined, serverAvailable: false });
    completeTutorReviewStep(handle);
    // The store itself, before any serialization.
    return tutorReviewRuns().at(-1)!.steps.find((step) => step.requestId === ids.requestId)!;
  }

  /** Each public code at a place where the real schemas carry it; the key spells exactly that code. */
  const codes: ReadonlyArray<readonly [string, "question" | "dialog" | "support", Record<string, unknown>, Record<string, unknown>, (step: ReturnType<typeof record>) => unknown]> = [
    ["answer", "dialog", { question: "Q?", answer: "a" }, { responseStyle: "normal", learnerInput: "answer", question: "Q?" }, (step) => step.response?.learnerInput],
    ["clarification", "dialog", { question: "Q?", answer: "a" }, { responseStyle: "normal", learnerInput: "clarification", question: "Q?" }, (step) => step.response?.learnerInput],
    ["help", "dialog", { question: "Q?", answer: "a" }, { responseStyle: "normal", learnerInput: "help", question: "Q?" }, (step) => step.response?.learnerInput],
    ["normal", "question", {}, { responseStyle: "normal", question: "Q?" }, (step) => step.response?.responseStyle],
    ["philosophical", "question", {}, { responseStyle: "philosophical", question: "Q?" }, (step) => step.response?.responseStyle],
    ["open", "dialog", { question: "Q?", answer: "a" }, { responseStyle: "normal", questionStatus: "open", question: "Q?" }, (step) => step.response?.questionStatus],
    ["closed", "dialog", { question: "Q?", answer: "a" }, { responseStyle: "normal", questionStatus: "closed", question: "Q?" }, (step) => step.response?.questionStatus],
    ["concept", "question", {}, { responseStyle: "normal", question: "Q?", questionKind: "concept" }, (step) => step.response?.learning?.questionKind],
    ["built-in", "question", {}, { responseStyle: "normal", question: "Q?", strategySource: "built-in" }, (step) => step.response?.learning?.strategySource],
    ["LEARN", "question", {}, { responseStyle: "normal", question: "Q?", learningPhase: "LEARN" }, (step) => step.response?.learning?.learningPhase],
    ["active", "question", {}, { responseStyle: "normal", question: "Q?", focusProgress: { state: "active", understoodAreas: 0, totalAreas: 2, openAreas: [] } }, (step) => step.response?.focusProgress?.state],
    ["assisted", "support", { action: "hint" }, { action: "hint", explanation: "E", support: { answerAttempts: 1, clarifications: 0, canRevealReference: true, canSkip: false, referenceShown: true, outcome: "assisted" } }, (step) => step.response?.support?.outcome],
    ["no-reference", "support", { action: "reveal" }, { action: "reveal", reference: { status: "unavailable", reason: "no-reference" } }, (step) => step.response?.reference],
    ["uno", "question", { board: "uno" }, { responseStyle: "normal", question: "Q?" }, (step) => tutorReviewRuns().at(-1)!.contexts.find((context) => context.contextId === step.contextId)?.board],
  ];

  for (const [code, endpoint, body, response, read] of codes) {
    it(`keeps the public code "${code}" when the key spells it`, () => {
      const step = record(endpoint, code, body, { model: "m", ...response });
      const value = read(step);
      expect(code === "no-reference" ? (value as { reason: string }).reason : value).toBe(code);
      exported();
    });
  }

  it("still redacts dynamic identifiers and free texts that contain the key", () => {
    const key = "loop";
    const step = record("question", key, { courseContent: { repository: "org/loop-course", ref: "main", revision: "a".repeat(40) } }, {
      model: "loop-model", responseStyle: "normal", question: "Why loop?", topic: "loop", topicId: "loop-basics", strategyId: "trace-loop",
      focusProgress: { state: "open", understoodAreas: 0, totalAreas: 1, openAreas: ["the loop"] },
    });
    expect(step.response).toMatchObject({
      question: `Why ${TUTOR_REVIEW_REDACTED}?`, topic: TUTOR_REVIEW_REDACTED, model: `${TUTOR_REVIEW_REDACTED}-model`,
      learning: { topicId: `${TUTOR_REVIEW_REDACTED}-basics`, strategyId: `trace-${TUTOR_REVIEW_REDACTED}` },
      focusProgress: { state: "open", openAreas: [`the ${TUTOR_REVIEW_REDACTED}`] },
    });
    expect(step.request?.courseContent?.repository).toBe(`org/${TUTOR_REVIEW_REDACTED}-course`);
    const context = tutorReviewRuns().at(-1)!.contexts[0];
    expect(context.code).toBe(`void ${TUTOR_REVIEW_REDACTED}() {}`);
    exported();
  });

  it("rejects unknown codes and keeps no raw fields beyond the allowed ones", () => {
    const step = record("dialog", "k3y", { question: "Q?", answer: "a", board: "not-a-board" }, {
      model: "m", responseStyle: "poetic", learnerInput: "shouting", questionStatus: "maybe", question: "Q?",
      questionKind: "riddle", focusProgress: { state: "lost", understoodAreas: 0, totalAreas: 1, openAreas: [] },
      support: { answerAttempts: 1, clarifications: 0, canRevealReference: false, canSkip: false, referenceShown: false, outcome: "won" },
      rawProviderBody: "k3y raw", authorization: "Bearer k3y",
    });
    expect(step.response).toEqual({ question: "Q?", model: "m", support: expect.not.objectContaining({ outcome: "won" }) });
    expect(step.response?.support).not.toHaveProperty("outcome");
    expect(tutorReviewRuns().at(-1)!.contexts[0]).not.toHaveProperty("board");
    exported();
  });

  it("drops a received server entry with an unknown code and marks the block invalid", () => {
    const ids = { traceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const handle = beginTutorReviewRequest({ ...ids, endpoint: "question", body: JSON.stringify({ code: "void loop() {}", credential: "k3y" }) });
    receiveTutorReviewResponse(handle, {
      ok: true, body: { responseStyle: "normal", question: "Q?", model: "m" }, serverAvailable: true,
      review: {
        version: 1, ...ids, operation: "question", promptRevision: PROMPT, guidanceRevision: "assessment-guidance-v1",
        guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE },
        entries: [{ kind: "classification", learnerInput: "shouting" }], dropped: 0, sanitized: 0,
      },
    });
    const step = tutorReviewRuns().at(-1)!.steps[0];
    expect(step.server).toEqual({ status: "invalid", entries: [] });
    expect(step.response?.question).toBe("Q?");
  });

  it("keeps the support codes of a skip's next question", () => {
    const next = { question: "Next normal?", responseStyle: "normal", questionKind: "transfer", learningPhase: "DEEPEN" };
    const step = record("support", "normal", { action: "skip" }, { action: "skip", next, provider: "kiconnect", model: "m" });
    tutorSupportResponseSchema.parse({ action: "skip", next, provider: "kiconnect", model: "m" });
    expect(step.response?.next).toMatchObject({ question: `Next ${TUTOR_REVIEW_REDACTED}?`, learning: { questionKind: "transfer", learningPhase: "DEEPEN" } });
  });
});

describe("follow-ups of the independent check", () => {
  beforeEach(() => clearTutorReviewRuns());
  afterEach(() => clearTutorReviewRuns());

  function capture(credential: string, response: Record<string, unknown>, options: { ok?: boolean; review?: (ids: { traceId: string; requestId: string }) => unknown } = {}) {
    const ids = { traceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const handle = beginTutorReviewRequest({ ...ids, endpoint: "question", body: JSON.stringify({ code: "void loop() {}", credential }) });
    receiveTutorReviewResponse(handle, { ok: options.ok ?? true, httpStatus: options.ok === false ? 503 : 200, body: response, review: options.review?.(ids), serverAvailable: true });
    return tutorReviewRuns().at(-1)!.steps[0];
  }

  // The runtime captures a response before the learning schema checks it; invalid numbers must not break the export.
  for (const [name, response] of [
    ["understood areas above total", { focusProgress: { state: "open", understoodAreas: 9, totalAreas: 3, openAreas: [] } }],
    ["no total areas", { focusProgress: { state: "open", understoodAreas: 0, totalAreas: 0, openAreas: [] } }],
    ["text instead of a count", { focusProgress: { state: "open", understoodAreas: "x", totalAreas: 2, openAreas: [] } }],
    ["fractional attempts", { support: { answerAttempts: 1.5, clarifications: 0, canRevealReference: false, canSkip: false, referenceShown: false, outcome: "open" } }],
    ["attempts out of range", { support: { answerAttempts: 5_000, clarifications: 0, canRevealReference: false, canSkip: false, referenceShown: false, outcome: "open" } }],
    ["text clarifications", { support: { answerAttempts: 1, clarifications: "x", canRevealReference: false, canSkip: false, referenceShown: false, outcome: "open" } }],
  ] as const) {
    it(`omits structure with invalid numbers and keeps the export valid (${name})`, () => {
      const step = capture("k3y", { responseStyle: "normal", question: "Q?", model: "m", ...response });
      expect(step.response).not.toHaveProperty("focusProgress");
      expect(step.response).not.toHaveProperty("support");
      expect(step.response?.question).toBe("Q?");
      exported();
    });
  }

  for (const key of ["e", "a", "E", "R", ".", "ü"]) {
    it(`confirms the server's identical rule texts also for the short key ${JSON.stringify(key)}`, () => {
      capture(key, { responseStyle: "normal", question: "Q", model: "m" }, {
        review: (ids) => ({
          version: 1, ...ids, operation: "question", promptRevision: PROMPT, guidanceRevision: "assessment-guidance-v1",
          guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE }, entries: [], dropped: 0, sanitized: 0,
        }),
      });
      expect(exported().legend).toMatchObject({ confirmation: "confirmed-by-server", serverSets: [] });
    });
  }

  it("redacts a credential that a server error code spells", () => {
    const step = capture("LEARN_KEY", { error: { code: "LEARN_KEY", message: "x" } }, { ok: false });
    expect(step.failure).toEqual({ httpStatus: 503, code: TUTOR_REVIEW_REDACTED });
    exported();
  });
});

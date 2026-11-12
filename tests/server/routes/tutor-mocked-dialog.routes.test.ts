import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../../server/config";
import { tutorReviewEnvelopeSchema } from "../../../shared/tutor-review";
import { tutorResponseSchema, type TutorSupportState } from "@shared/tutor";
import { tutorSupportResponseSchema } from "@shared/tutor-support";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { createTutorService } from "../../../server/services/tutor/tutor-service-factory";
import { KiconnectProvider } from "../../../server/services/tutor/kiconnect-provider";
import type { TutorService } from "../../../server/services/tutor/tutor-service";
import { TutorSupportStore } from "../../../server/services/tutor/learning-support-store";
import { TutorCourseContentSessionStore } from "../../../server/services/course-content/course-content-session";
import type { LLMProviderRequest } from "../../../server/services/tutor/llm-provider";
import { TUTOR_SUPPORT_GUIDANCE_TEXT } from "../../../server/services/tutor/learning-support";
import {
  IT064_CONCEPT_QUESTION,
  IT064_PREDICTION_QUESTION,
  IT064_SKETCH,
  it064Content,
} from "../services/tutor/fixtures/it06-4";

/**
 * A mocked dialog over the production routes (Plan: Tutor-Testabdeckung, Aufgabe 3). Only the LLM
 * provider and the Course Content source are fakes. Classification, grading, the reference check,
 * the planner and all stores are real. The provider is strict: it knows the four prompt kinds of the
 * production prompts (initial question, dialog, clarification, hint) and nothing else; each test states its call plan
 * per kind, a call beyond the plan or of an unknown kind is refused, and after each test the calls must equal the plan.
 */

type Kind = "question" | "dialog" | "clarify" | "hint";
/** The planned number of provider generations per kind for one test; a further call is refused. */
type Plan = Readonly<Record<Kind, number>>;
const plan = (counts: Partial<Plan>): Plan => ({ question: 0, dialog: 0, clarify: 0, hint: 0, ...counts });

/** The prompt kind by its production header; undefined for any other prompt. */
function promptKind(userPrompt: string): Kind | undefined {
  if (userPrompt.startsWith("Erzeuge eine einzige Lernfrage")) return "question";
  if (userPrompt.startsWith("Führe den sokratischen Lerndialog")) return "dialog";
  if (userPrompt.startsWith(TUTOR_SUPPORT_GUIDANCE_TEXT.clarify)) return "clarify";
  if (userPrompt.startsWith(TUTOR_SUPPORT_GUIDANCE_TEXT.hint)) return "hint";
  return undefined;
}

/** Refused or unplanned calls of the running test, and the end-of-test comparisons of calls and plans. */
let violations: string[] = [];
let planChecks: (() => void)[] = [];

/** Counts one generation against the plan; an unknown kind or a call beyond the plan is recorded and refused. */
function admit(calls: Record<Kind, number>, budget: Plan, userPrompt: string): Kind {
  const kind = promptKind(userPrompt);
  if (!kind) {
    violations.push(`unknown prompt kind: ${JSON.stringify(userPrompt.split("\n")[0]?.slice(0, 80))}`);
    throw new Error("strict fake: unknown prompt kind");
  }
  calls[kind] += 1;
  if (calls[kind] > budget[kind]) {
    violations.push(`${kind} call ${calls[kind]} beyond the plan of ${budget[kind]}`);
    throw new Error(`strict fake: unplanned ${kind} call`);
  }
  return kind;
}

/** Registers the end-of-test check: no refused call, and every kind called exactly as planned. */
function checkPlanAfterTest(calls: Record<Kind, number>, budget: Plan) {
  planChecks.push(() => expect({ calls, violations }).toEqual({ calls: budget, violations: [] }));
}

interface Rating { readonly rating: 1 | 2 | 3 | 4 | 5; readonly feedback: string }

// Distinct texts: the service rejects an explanation that merely repeats the previous one (R-SUP-9).
const EXPLANATIONS = [
  "Gemeint ist der allererste Schleifendurchlauf, in dem die Zählvariable den Startwert sieben hat.",
  "Schau nur auf den Serial.print-Aufruf innerhalb der Schleife: Gesucht ist ein einzelnes ausgegebenes Zeichen.",
  "Die Frage legt den Wert der Variablen selbst fest; rechne mit diesem Wert statt mit dem aus der Deklaration.",
  "Zerlege den Ausdruck in Verschiebung, bitweises Und und logisches Und und werte die Teile nacheinander aus.",
];

function promptPart(prompt: string, label: string, end = "\n"): string {
  const start = prompt.indexOf(label);
  if (start < 0) return "";
  const from = start + label.length;
  const to = prompt.indexOf(end, from);
  return prompt.slice(from, to < 0 ? undefined : to);
}

const course = { repository: "ttbombadil/unosim-examples", ref: "main", revision: "6".repeat(40), exampleId: "it06-04-binaerzahl" };
const SUBJECT = "learner.a";

let server: http.Server | undefined;
const diagnosticsBefore = config.tutor.diagnosticsEnabled;
afterEach(async () => {
  config.tutor.diagnosticsEnabled = diagnosticsBefore;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  const checks = planChecks;
  const refused = violations;
  planChecks = [];
  violations = [];
  for (const check of checks) check();
  expect(refused).toEqual([]);
});

async function start(rate: (answer: string, question: string) => Rating, options: { readonly service?: TutorService; readonly plan: Plan }) {
  const budget = options.plan;
  // The explanation script is bounded: no explanation text is ever served twice.
  expect(budget.clarify + budget.hint).toBeLessThanOrEqual(EXPLANATIONS.length);
  const calls: Record<Kind, number> = { question: 0, dialog: 0, clarify: 0, hint: 0 };
  checkPlanAfterTest(calls, budget);
  const answers: string[] = [];
  const provider = {
    listModels: vi.fn().mockResolvedValue(["m"]),
    generateLearningQuestion: vi.fn(async ({ userPrompt }: LLMProviderRequest) => {
      const kind = admit(calls, budget, userPrompt);
      if (kind === "question") {
        // The course-bound initial question comes from the plan; the model's own question is only a stand-in.
        return { model: "m", result: { responseStyle: "normal" as const, question: "Welche Rolle spielt Serial.begin im Sketch?" } };
      }
      if (kind === "dialog") {
        const answer = promptPart(userPrompt, "Aktuelle Nutzerantwort:\n```text\n", "\n```");
        answers.push(answer);
        const { rating, feedback } = rate(answer, promptPart(userPrompt, "Aktuelle Tutorfrage:\n"));
        return { model: "m", result: { responseStyle: "normal" as const, feedback, question: "Was gibt der zweite Durchlauf aus?", answerRating: rating } };
      }
      const explanation = EXPLANATIONS[calls.clarify + calls.hint - 1]!;
      return { model: "m", result: { responseStyle: "normal" as const, feedback: explanation, question: promptPart(userPrompt, "Aktuelle Frage:\n") } };
    }),
  };
  const sessionStore = new TutorCourseContentSessionStore();
  const supportStore = new TutorSupportStore();
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: SUBJECT, roles: ["user"] };
    next();
  });
  registerTutorRoutes(app, {
    supportStore,
    sessionStore,
    service: options.service ?? createTutorService(provider),
    courseContent: { resolveTutorContent: vi.fn(async () => it064Content()) } as never,
    disableRateLimit: true,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (route: string, body: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };

  /** The browser's dialog: the question, support binding and Course session of each response are taken over. */
  async function openDialog() {
    const first = await post("/api/tutor/question", { code: IT064_SKETCH, credential: "key", courseContent: course, learningSupport: true });
    expect(first.status).toBe(200);
    expect(tutorResponseSchema.safeParse(first.body).success).toBe(true);
    const state = {
      question: first.body.question as string,
      support: first.body.support as TutorSupportState,
      session: first.body.courseContentSession as string,
    };
    const bind = () => ({ supportSession: state.support.session, questionHandle: state.support.questionHandle, actionId: randomUUID() });
    const body = (text: string, actionId?: string) => ({
      code: IT064_SKETCH, credential: "key", history: [], question: state.question, answer: text,
      courseContentSession: state.session, ...bind(), ...(actionId ? { actionId } : {}),
    });
    const answer = async (text: string, actionId?: string) => {
      const response = await post("/api/tutor/dialog", body(text, actionId));
      if (response.status === 200) {
        expect(tutorResponseSchema.safeParse(response.body).success).toBe(true);
        state.question = response.body.question;
        state.support = response.body.support;
      }
      return response;
    };
    const act = async (action: "clarify" | "hint" | "reveal" | "skip", actionId?: string) => {
      const response = await post("/api/tutor/support", {
        code: IT064_SKETCH, credential: "key", history: [], action, courseContentSession: state.session, ...bind(), ...(actionId ? { actionId } : {}),
      });
      if (response.status === 200) {
        expect(tutorSupportResponseSchema.safeParse(response.body).success).toBe(true);
        if (response.body.next) state.question = response.body.next.question;
        if (response.body.support) state.support = response.body.support;
      }
      return response;
    };
    /** Progression evidence of the session as the server stores it. */
    const evidence = () => structuredClone(sessionStore.get(SUBJECT, state.session)!.progressionState);
    return { state, answer, act, body, evidence, bind };
  }

  /** Answers the focus concept question well, so that the IT06.4 prediction question is asked next. */
  async function toPrediction() {
    const dialog = await openDialog();
    expect(dialog.state.question).toBe(IT064_CONCEPT_QUESTION);
    expect((await dialog.answer("Sie maskiert genau das Bit i.")).status).toBe(200);
    expect(dialog.state.question).toBe(IT064_PREDICTION_QUESTION);
    return dialog;
  }
  return { post, calls, answers, provider, toPrediction, openDialog };
}

/** The focus concept question is answered well; `rating` applies to every other question. */
function conceptThen(rating: 1 | 2 | 3 | 4 | 5, feedback = "Rückmeldung."): (answer: string, question: string) => Rating {
  return (_answer, question) => question === IT064_CONCEPT_QUESTION ? { rating: 5, feedback: "Ja." } : { rating, feedback };
}

describe("SD-01: clarification, help and answer are told apart by the real classifier", () => {
  it.each([
    ["Welche Variable meinst du?", "clarification"],
    ["Ich brauche einen Tipp", "help"],
  ] as const)("%j is %s: the question stays, no stars, no attempt, no evidence", async (text, kind) => {
    const { toPrediction, calls } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 1, ...(kind === "clarification" ? { clarify: 1 } : { hint: 1 }) }) });
    const dialog = await toPrediction();
    const before = dialog.evidence();
    const handle = dialog.state.support.questionHandle;

    const response = await dialog.answer(text);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ learnerInput: kind, question: IT064_PREDICTION_QUESTION });
    expect(response.body.answerRating).toBeUndefined();
    expect(dialog.state.support).toMatchObject({ questionHandle: handle, answerAttempts: 0 });
    expect(dialog.state.support.clarifications).toBe(kind === "clarification" ? 1 : 0);
    expect(dialog.evidence()).toEqual(before);
    // Nothing needed a rating call: the dialog counter did not move.
    expect(calls.dialog).toBe(1);
  });

  it.each([
    "Ist es 1?",
    "Meine Erklärung: Bit 7 ist gesetzt, also 1.",
    "Gibt es eine 1 aus, weil das Bit gesetzt ist?",
  ])("%j is an answer attempt: it is rated, the question mark alone does not turn it into a clarification", async (text) => {
    const { toPrediction, calls } = await start(conceptThen(2, "Nicht ganz."), { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    const ratingCalls = calls.dialog;

    const response = await dialog.answer(text);
    expect(response.status).toBe(200);
    expect(response.body.learnerInput).toBe("answer");
    expect(calls.dialog).toBe(ratingCalls + 1);
    expect(response.body.answerRating).toBe(2);
    expect(dialog.state.support.clarifications).toBe(0);
  });

  it("a wrong answer attempt counts as an attempt and leaves one observation; the clarification before it did not", async () => {
    const { toPrediction } = await start(conceptThen(2, "Nicht ganz."), { plan: plan({ question: 1, dialog: 2, clarify: 1 }) });
    const dialog = await toPrediction();
    const observations = (): number => Object.values(dialog.evidence().masteryEvidence).flat().length;
    const base = observations();

    await dialog.answer("Welche Variable meinst du?");
    expect(observations()).toBe(base);
    expect(dialog.state.support.answerAttempts).toBe(0);

    const attempt = await dialog.answer("7");
    expect(attempt.body.learnerInput).toBe("answer");
    expect(dialog.state.support).toMatchObject({ answerAttempts: 1, clarifications: 1 });
    expect(observations()).toBe(base + 1);
  });
});

describe("SD-02: the reviewed reference decides; the model's own rating is kept apart", () => {
  const model = (answer: string, question: string): Rating => {
    if (question === IT064_CONCEPT_QUESTION) return { rating: 5, feedback: "Ja." };
    // Hand-checked IT06.4: 200 & 128 = 128, so the first output is 1; the fake gets it exactly backwards.
    return answer === "0" ? { rating: 5, feedback: "Richtig." } : { rating: 1, feedback: "Falsch, es wird 0 ausgegeben." };
  };

  it("the correct answer 1 is delivered as correct (band 4-5), although the model rated it 1 and called it wrong", async () => {
    const { toPrediction } = await start(model, { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    const response = await dialog.answer("1");
    expect(response.status).toBe(200);
    expect(response.body.answerRating).toBeGreaterThanOrEqual(4);
    expect(response.body.answerRating).toBeLessThanOrEqual(5);
    expect(response.body.feedback).not.toMatch(/falsch|0 ausgegeben/i);
    expect(response.body.question).not.toBe(IT064_PREDICTION_QUESTION);
  });

  it("the review keeps the model's raw rating (1) apart from the delivered, reference-corrected rating (real provider adapter, stubbed fetch)", async () => {
    config.tutor.diagnosticsEnabled = true;
    (config.tutor as { autoModels: readonly string[] }).autoModels = ["listed-model"];
    const realFetch = globalThis.fetch;
    // The same strictness for the model endpoint behind the real adapter: question and dialog prompts only, as planned.
    const endpointCalls: Record<Kind, number> = { question: 0, dialog: 0, clarify: 0, hint: 0 };
    const endpointPlan = plan({ question: 1, dialog: 2 });
    checkPlanAfterTest(endpointCalls, endpointPlan);
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, init); // the test's own HTTP client
      if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "listed-model" }] }), { status: 200 });
      const prompt = JSON.parse(String(init?.body)).messages[1].content as string;
      admit(endpointCalls, endpointPlan, prompt);
      const answer = promptPart(prompt, "Aktuelle Nutzerantwort:\n```text\n", "\n```");
      const rated = model(answer, promptPart(prompt, "Aktuelle Tutorfrage:\n"));
      const content = prompt.startsWith("Erzeuge eine einzige Lernfrage")
        ? { responseStyle: "normal", question: "Welche Rolle spielt Serial.begin im Sketch?" }
        : { responseStyle: "normal", feedback: rated.feedback, question: "Was gibt der zweite Durchlauf aus?", answerRating: rated.rating };
      return new Response(JSON.stringify({ model: "listed-model", choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    });
    try {
      const { toPrediction, post } = await start(model, { service: createTutorService(new KiconnectProvider()), plan: plan({}) });
      const dialog = await toPrediction();
      const response = await post("/api/tutor/dialog", dialog.body("1"), { "x-unosim-tutor-debug": "1", "x-request-id": randomUUID() });
      expect(response.status).toBe(200);
      const review = tutorReviewEnvelopeSchema.parse(response.body.review);
      const draft = review.entries.find((entry) => entry.kind === "draft");
      expect(draft).toMatchObject({ kind: "draft", answerRating: 1 });
      expect(draft && "feedback" in draft ? draft.feedback : undefined).toContain("Falsch");
      expect(response.body.answerRating).toBeGreaterThanOrEqual(4);
      expect(response.body.feedback).not.toMatch(/falsch/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the counter-check 0 is not accepted as correct although the model rated it 5", async () => {
    const { toPrediction } = await start(model, { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    const response = await dialog.answer("0");
    expect(response.body.answerRating).toBeLessThanOrEqual(2);
    expect(response.body.feedback).not.toContain("Richtig");
    expect(response.body.question).toBe(IT064_PREDICTION_QUESTION);
    expect(dialog.state.support.answerAttempts).toBe(1);
  });
});

describe("SD-03: the boundaries of skip and reference", () => {
  it("two clarifications unlock skipping but not the reference; the reference needs three own answers", async () => {
    const { toPrediction } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 4, clarify: 2 }) });
    const dialog = await toPrediction();
    const locked = async (action: "skip" | "reveal") => (await dialog.act(action)).body.error?.code;

    expect(dialog.state.support).toMatchObject({ canSkip: false, canRevealReference: false });
    await dialog.act("clarify");
    expect(dialog.state.support).toMatchObject({ clarifications: 1, canSkip: false, canRevealReference: false });
    expect(await locked("skip")).toBe("SUPPORT_LOCKED");
    const second = await dialog.act("clarify");
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(dialog.state.support).toMatchObject({ clarifications: 2, answerAttempts: 0, canSkip: true, canRevealReference: false });
    expect(await locked("reveal")).toBe("SUPPORT_LOCKED");

    // Own wrong answers: the reference opens exactly with the third one.
    for (const [index, text] of ["0", "2", "7"].entries()) {
      expect(dialog.state.support.canRevealReference).toBe(false);
      await dialog.answer(text);
      expect(dialog.state.support.answerAttempts).toBe(index + 1);
    }
    expect(dialog.state.support.canRevealReference).toBe(true);
    const revealed = await dialog.act("reveal");
    expect(revealed.body.reference).toMatchObject({ status: "available", answer: "1" });
  });

  it("after the reference was shown, a repeated answer gives no new independent rating and adds no evidence", async () => {
    const { toPrediction, calls } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 5 }) });
    const dialog = await toPrediction();
    for (const text of ["0", "2", "7"]) await dialog.answer(text);
    await dialog.act("reveal");
    const before = dialog.evidence();
    const ratingCalls = calls.dialog;

    const after = await dialog.answer("1");
    expect(after.status).toBe(200);
    expect(after.body.answerRating).toBeUndefined();
    expect(after.body.focusProgress.understoodAreas).toBe(0);
    expect(dialog.evidence().masteryEvidence).toEqual(before.masteryEvidence);
    expect(dialog.evidence().postMasteryEvidence).toEqual(before.postMasteryEvidence);
    // The model is asked once more for feedback text (the test's plan fixes that call), but no competence entry follows.
    expect(calls.dialog).toBe(ratingCalls + 1);
  });
});

describe("SD-04: retries and distinct actions", () => {
  it("an identical retry counts once, replays the response and calls the provider no second time; no double evidence", async () => {
    const { toPrediction, calls } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    const actionId = randomUUID();
    const payload = dialog.body("7", actionId);
    const first = await (async () => {
      const response = await fetch(`${(server!.address() as AddressInfo).port ? `http://127.0.0.1:${(server!.address() as AddressInfo).port}` : ""}/api/tutor/dialog`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    })();
    expect(first.status).toBe(200);
    const evidenceAfterFirst = dialog.evidence();
    const ratingCalls = calls.dialog;

    const retry = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/tutor/dialog`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const retryBody = await retry.json() as Record<string, any>;
    expect(retry.status).toBe(200);
    expect(retryBody).toEqual(first.body);
    expect(retryBody.support.answerAttempts).toBe(1);
    expect(calls.dialog).toBe(ratingCalls);
    expect(dialog.evidence()).toEqual(evidenceAfterFirst);
  });

  it("the same action id with other data is a conflict and changes nothing", async () => {
    const { toPrediction, calls, post } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    const actionId = randomUUID();
    const original = dialog.body("7", actionId);
    expect((await post("/api/tutor/dialog", original)).status).toBe(200);
    const evidence = dialog.evidence();
    const ratingCalls = calls.dialog;

    const conflict = await post("/api/tutor/dialog", { ...original, answer: "8" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("SUPPORT_CONFLICT");
    expect(calls.dialog).toBe(ratingCalls);
    expect(dialog.evidence()).toEqual(evidence);
  });

  it("two different real actions stay two actions: two attempts, two observations", async () => {
    const { toPrediction } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 3 }) });
    const dialog = await toPrediction();
    const observations = (): number => Object.values(dialog.evidence().masteryEvidence).flat().length;
    const base = observations();
    await dialog.answer("7");
    await dialog.answer("7");
    expect(dialog.state.support.answerAttempts).toBe(2);
    expect(observations()).toBe(base + 2);
  });
});

describe("SD-05: without a reviewed reference the rating stays model-dependent", () => {
  it("the same answer 1 follows the model's rating when the code has no reviewed reference", async () => {
    const changed = IT064_SKETCH.replace("a & (1 << i) && 1", "bitRead(a, i)");
    const calls: Record<Kind, number> = { question: 0, dialog: 0, clarify: 0, hint: 0 };
    const budget = plan({ question: 1, dialog: 1 });
    checkPlanAfterTest(calls, budget);
    const provider = {
      listModels: vi.fn().mockResolvedValue(["m"]),
      generateLearningQuestion: vi.fn(async ({ userPrompt }: LLMProviderRequest) => {
        if (admit(calls, budget, userPrompt) === "dialog") {
          return { model: "m", result: { responseStyle: "normal" as const, feedback: "Modellurteil.", question: "Was gibt der zweite Durchlauf aus?", answerRating: 1 } };
        }
        return { model: "m", result: { responseStyle: "normal" as const, question: "Welche Rolle spielt Serial.begin im Sketch?" } };
      }),
    };
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => { res.locals.unosimIdentity = { subject: SUBJECT, roles: ["user"] }; next(); });
    registerTutorRoutes(app, {
      supportStore: new TutorSupportStore(),
      service: createTutorService(provider),
      courseContent: { resolveTutorContent: vi.fn(async () => it064Content()) } as never,
      disableRateLimit: true,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = async (route: string, body: unknown) => {
      const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const first = await post("/api/tutor/question", { code: changed, credential: "key", courseContent: course, learningSupport: true });
    expect(first.body.support.referenceAvailable).toBe(false);
    const answered = await post("/api/tutor/dialog", {
      code: changed, credential: "key", history: [], question: first.body.question, answer: "1", courseContentSession: first.body.courseContentSession,
      supportSession: first.body.support.session, questionHandle: first.body.support.questionHandle, actionId: randomUUID(),
    });
    expect(answered.status).toBe(200);
    // No reviewed reference binds to the changed code: the model's own rating is delivered unchanged. This
    // says nothing about the application correcting wrong model ratings in general.
    expect(answered.body.answerRating).toBe(1);
    expect(calls.dialog).toBe(1);
  });
});

describe("the strict provider fake itself", () => {
  /** Takes the recorded refusals and plan checks of this test out of the shared end-of-test check, to examine them here. */
  function takeRecorded() {
    const recorded = { violations, checks: planChecks };
    violations = [];
    planChecks = [];
    return recorded;
  }

  it("positive control: the regular flow runs exactly to its plan", async () => {
    const { toPrediction, calls } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 2 }) });
    const dialog = await toPrediction();
    expect((await dialog.answer("7")).status).toBe(200);
    expect(calls).toEqual(plan({ question: 1, dialog: 2 }));
  });

  it("negative control: an answer beyond the plan is refused, fails the request and is reported", async () => {
    const { toPrediction, calls } = await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 1 }) });
    const dialog = await toPrediction();
    const extra = await dialog.answer("7");
    expect(extra.status).not.toBe(200);
    expect(calls.dialog).toBe(2);
    const recorded = takeRecorded();
    expect(recorded.violations).toEqual(["dialog call 2 beyond the plan of 1"]);
    expect(() => { for (const check of recorded.checks) check(); }).toThrow();
  });

  it("negative control: a prompt of an unknown kind is refused and reported", () => {
    const calls: Record<Kind, number> = { question: 0, dialog: 0, clarify: 0, hint: 0 };
    expect(() => admit(calls, plan({ question: 1, dialog: 1, clarify: 1, hint: 1 }), "Fasse den Sketch zusammen.")).toThrow("unknown prompt kind");
    expect(calls).toEqual(plan({}));
    expect(takeRecorded().violations).toEqual(['unknown prompt kind: "Fasse den Sketch zusammen."']);
  });

  it("negative control: a planned call that never came fails the end-of-test check", async () => {
    await start(conceptThen(2, "Noch nicht."), { plan: plan({ question: 1, dialog: 1, clarify: 1 }) });
    const recorded = takeRecorded();
    expect(recorded.violations).toEqual([]);
    expect(() => { for (const check of recorded.checks) check(); }).toThrow();
  });
});

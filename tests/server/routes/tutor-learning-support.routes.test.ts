import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema, type TutorSupportState } from "@shared/tutor";
import { tutorSupportResponseSchema } from "@shared/tutor-support";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { createTutorService } from "../../../server/services/tutor/tutor-service-factory";
import { TutorProviderError, type LLMProviderRequest } from "../../../server/services/tutor/llm-provider";
import {
  IT064_CONCEPT_QUESTION,
  IT064_PREDICTION_QUESTION,
  IT064_SKETCH,
  IT064_SKETCH_A200,
  it064Content,
} from "../services/tutor/fixtures/it06-4";

/**
 * Learning-support cycle at the HTTP boundary (LearningQuestions 3.10, TutorQualityGates 8): the real
 * routes, TutorService, planner and stores; only the LLM provider is scripted. Every request carries the
 * fields the browser sends, and the session state returned by one response is used by the next request.
 */

const EXPLANATIONS = [
  "Gemeint ist der allererste Schleifendurchlauf, in dem die Zählvariable den Startwert sieben hat.",
  "Schau nur auf den Serial.print-Aufruf innerhalb der Schleife: Gesucht ist ein einzelnes ausgegebenes Zeichen.",
  "Die Frage legt den Wert der Variablen selbst fest; rechne mit diesem Wert statt mit dem aus der Deklaration.",
  "Zerlege den Ausdruck in Verschiebung, bitweises Und und logisches Und und werte die Teile nacheinander aus.",
];

interface Script {
  rate: (answer: string, question: string) => { rating: 1 | 2 | 3 | 4 | 5; feedback: string };
  freeQuestions: string[];
  failNext: boolean;
  delay?: Promise<void>;
}

function promptPart(prompt: string, label: string, end = "\n"): string {
  const start = prompt.indexOf(label);
  if (start < 0) return "";
  const from = start + label.length;
  const to = prompt.indexOf(end, from);
  return prompt.slice(from, to < 0 ? undefined : to);
}

function scriptedProvider(script: Script) {
  let explanations = 0;
  const generateLearningQuestion = vi.fn(async ({ userPrompt }: LLMProviderRequest) => {
    await script.delay;
    if (script.failNext) {
      script.failNext = false;
      throw new TutorProviderError("invalid-response");
    }
    if (userPrompt.startsWith("Erzeuge eine einzige Lernfrage")) {
      return { model: "m", result: { responseStyle: "normal" as const, question: script.freeQuestions.shift() ?? "Welche Rolle spielt Serial.begin im Sketch?" } };
    }
    if (userPrompt.startsWith("Führe den sokratischen Lerndialog")) {
      const answer = promptPart(userPrompt, "Aktuelle Nutzerantwort:\n```text\n", "\n```");
      const question = promptPart(userPrompt, "Aktuelle Tutorfrage:\n");
      const { rating, feedback } = script.rate(answer, question);
      return { model: "m", result: { responseStyle: "normal" as const, feedback, question: "Was gibt der zweite Durchlauf aus?", answerRating: rating } };
    }
    const explanation = EXPLANATIONS[explanations % EXPLANATIONS.length]!;
    explanations += 1;
    return { model: "m", result: { responseStyle: "normal" as const, feedback: explanation, question: promptPart(userPrompt, "Aktuelle Frage:\n") } };
  });
  return { listModels: vi.fn().mockResolvedValue(["m"]), generateLearningQuestion };
}

/** The focus concept question is always answered well; `rating` applies to every other question. */
function conceptThen(rating: 1 | 2 | 3 | 4 | 5, feedback = "Rückmeldung."): Script["rate"] {
  return (_answer, question) => question === IT064_CONCEPT_QUESTION ? { rating: 5, feedback: "Ja." } : { rating, feedback };
}

let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

async function start(script: Partial<Script> = {}) {
  const fullScript: Script = { rate: () => ({ rating: 5, feedback: "Stimmt." }), freeQuestions: [], failNext: false, ...script };
  const provider = scriptedProvider(fullScript);
  const resolver = { resolveTutorContent: vi.fn(async () => it064Content()) };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.unosimIdentity = { subject: req.header("x-subject") ?? "learner.a", roles: ["user"] };
    next();
  });
  registerTutorRoutes(app, {
    service: createTutorService(provider),
    courseContent: resolver as never,
    disableRateLimit: true,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (route: string, body: unknown, options: { subject?: string; signal?: AbortSignal } = {}) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(options.subject ? { "x-subject": options.subject } : {}) },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { post, provider, script: fullScript, url: base };
}

const course = { repository: "ttbombadil/unosim-examples", ref: "main", revision: "6".repeat(40), exampleId: "it06-04-binaerzahl" };

/** The browser's dialog: it keeps the question, the Course session and the support binding of each response. */
async function openDialog(post: Awaited<ReturnType<typeof start>>["post"], code = IT064_SKETCH) {
  const first = await post("/api/tutor/question", { code, credential: "key", courseContent: course, learningSupport: true });
  expect(first.status).toBe(200);
  expect(tutorResponseSchema.safeParse(first.body).success).toBe(true);
  const state = {
    code,
    question: first.body.question as string,
    support: first.body.support as TutorSupportState,
    courseContentSession: first.body.courseContentSession as string,
  };
  const bind = () => ({ supportSession: state.support.session, questionHandle: state.support.questionHandle, actionId: randomUUID() });
  const answer = async (text: string, options: { actionId?: string; code?: string } = {}) => {
    const response = await post("/api/tutor/dialog", {
      code: options.code ?? state.code, credential: "key", history: [], question: state.question, answer: text,
      courseContentSession: state.courseContentSession, ...bind(), ...(options.actionId ? { actionId: options.actionId } : {}),
    });
    if (response.status === 200) {
      expect(tutorResponseSchema.safeParse(response.body).success).toBe(true);
      state.question = response.body.question;
      state.support = response.body.support;
    }
    return response;
  };
  const act = async (action: "clarify" | "hint" | "reveal" | "skip", options: { actionId?: string } = {}) => {
    const response = await post("/api/tutor/support", {
      code: state.code, credential: "key", history: [], action, courseContentSession: state.courseContentSession,
      ...bind(), ...(options.actionId ? { actionId: options.actionId } : {}),
    });
    if (response.status === 200) {
      expect(tutorSupportResponseSchema.safeParse(response.body).success).toBe(true);
      if (response.body.next) state.question = response.body.next.question;
      if (response.body.support) state.support = response.body.support;
    }
    return response;
  };
  return { first: first.body, state, answer, act, bind };
}

/** Answers the focus concept question well, so that the IT06.4 prediction question is asked next. */
async function toPredictionQuestion(post: Awaited<ReturnType<typeof start>>["post"], code = IT064_SKETCH) {
  const dialog = await openDialog(post, code);
  expect(dialog.state.question).toBe(IT064_CONCEPT_QUESTION);
  expect((await dialog.answer("Sie maskiert genau das Bit i.")).status).toBe(200);
  expect(dialog.state.question).toBe(IT064_PREDICTION_QUESTION);
  return dialog;
}

describe("learning support over HTTP: thresholds and unlocks", () => {
  it("opens with zero counters only when the request opts in; the MVP request stays unchanged", async () => {
    const { post } = await start();
    const supported = await openDialog(post);
    expect(supported.state.support).toMatchObject({
      answerAttempts: 0, clarifications: 0, canRevealReference: false, canSkip: false, referenceAvailable: false, outcome: "open",
    });

    const legacy = await post("/api/tutor/question", { code: IT064_SKETCH, credential: "key", courseContent: course });
    expect(legacy.status).toBe(200);
    expect(legacy.body.support).toBeUndefined();
    const legacyAnswer = await post("/api/tutor/dialog", {
      code: IT064_SKETCH, credential: "key", history: [], question: legacy.body.question, answer: "Sie verschiebt", courseContentSession: legacy.body.courseContentSession,
    });
    expect(legacyAnswer.status).toBe(200);
    expect(legacyAnswer.body.support).toBeUndefined();
    expect(legacyAnswer.body.answerRating).toBe(5);
  });

  it("allows skipping after two answered clarifications, without any answer and without the reference answer", async () => {
    const { post } = await start();
    const dialog = await toPredictionQuestion(post);
    const handle = dialog.state.support.questionHandle;

    expect((await dialog.act("skip")).body.error.code).toBe("SUPPORT_LOCKED");
    const first = await dialog.act("clarify");
    expect(first.status).toBe(200);
    expect(first.body.explanation).toBe(EXPLANATIONS[0]);
    expect(first.body.answerRating).toBeUndefined();
    expect(dialog.state.support).toMatchObject({ questionHandle: handle, clarifications: 1, answerAttempts: 0, canSkip: false });
    expect((await dialog.act("skip")).body.error.code).toBe("SUPPORT_LOCKED");

    const second = await dialog.act("clarify");
    expect(second.body.explanation).not.toBe(first.body.explanation);
    expect(dialog.state.support).toMatchObject({ questionHandle: handle, clarifications: 2, answerAttempts: 0, canSkip: true, canRevealReference: false });
    // Two clarifications do not unlock the reference answer (R-SUP-4).
    expect((await dialog.act("reveal")).body.error.code).toBe("SUPPORT_LOCKED");

    const skipped = await dialog.act("skip");
    expect(skipped.status).toBe(200);
    expect(skipped.body.reference).toBeUndefined();
    expect(skipped.body.next.question).not.toBe(IT064_PREDICTION_QUESTION);
    expect(skipped.body.next.answerRating).toBeUndefined();
    expect(dialog.state.support).toMatchObject({ answerAttempts: 0, clarifications: 0, canSkip: false, outcome: "open" });
    expect(dialog.state.support.questionHandle).not.toBe(handle);
    // The skipped area is not reported as understood (R-SUP-5).
    expect(skipped.body.focusProgress?.understoodAreas ?? 0).toBe(0);
  });

  it("unlocks the reference answer after the third own answer and keeps the question until then", async () => {
    const { post } = await start({ rate: conceptThen(2, "Noch nicht.") });
    const dialog = await toPredictionQuestion(post);
    const handle = dialog.state.support.questionHandle;

    for (const [attempt, text] of ["0", "2", "200"].entries()) {
      if (attempt < 2) expect((await dialog.act("reveal")).body.error.code).toBe("SUPPORT_LOCKED");
      const response = await dialog.answer(text);
      expect(response.status).toBe(200);
      expect(response.body.question).toBe(IT064_PREDICTION_QUESTION);
      expect(response.body.answerRating).toBeLessThanOrEqual(2);
      expect(dialog.state.support).toMatchObject({ questionHandle: handle, answerAttempts: attempt + 1, canRevealReference: attempt === 2 });
    }
    expect(dialog.state.support.canSkip).toBe(false);

    const revealed = await dialog.act("reveal");
    expect(revealed.status).toBe(200);
    expect(revealed.body.reference).toMatchObject({ status: "available", answer: "1" });
    expect(revealed.body.reference.explanation).toContain("200 & 128 = 128");
    expect(dialog.state.support).toMatchObject({ referenceShown: true, outcome: "open" });

    // Further attempts stay possible; an answer after the reference earns no rating and no mastery (R-SUP-5).
    const after = await dialog.answer("1");
    expect(after.status).toBe(200);
    expect(after.body.answerRating).toBeUndefined();
    expect(after.body.question).not.toBe(IT064_PREDICTION_QUESTION);
    expect(after.body.focusProgress.understoodAreas).toBe(0);
  });
});

describe("learning support over HTTP: correct grading of IT06.4 (R-SUP-8)", () => {
  it("accepts 1 and 200 = 1 even when the model calls them wrong, and rejects 0 even when it calls it right", async () => {
    const { post } = await start({
      rate: (answer, question) => {
        if (question === IT064_CONCEPT_QUESTION) return { rating: 5, feedback: "Ja." };
        return answer === "0" ? { rating: 5, feedback: "Richtig." } : { rating: 2, feedback: "Falsch, es wird 0 ausgegeben." };
      },
    });
    const zero = await toPredictionQuestion(post);
    const rejected = await zero.answer("0");
    expect(rejected.body.answerRating).toBe(2);
    expect(rejected.body.feedback).not.toContain("Richtig");
    expect(rejected.body.question).toBe(IT064_PREDICTION_QUESTION);

    for (const correct of ["1", "200 = 1", "200=1"]) {
      const dialog = await toPredictionQuestion(post);
      expect(dialog.state.support.referenceAvailable).toBe(true);
      const response = await dialog.answer(correct);
      expect(response.body.answerRating).toBe(5);
      expect(response.body.feedback).not.toMatch(/falsch|0 ausgegeben/i);
      // An early correct answer is recognized at once: no further attempts are required (R-SUP-3).
      expect(response.body.question).not.toBe(IT064_PREDICTION_QUESTION);
      expect(dialog.state.support).toMatchObject({ answerAttempts: 0, outcome: "open" });
    }
  });

  it("keeps the reference for the question's own assumption after the editor value changed to 200", async () => {
    const { post } = await start({ rate: conceptThen(5, "Ja.") });
    const dialog = await toPredictionQuestion(post, IT064_SKETCH_A200);
    expect(dialog.state.support.referenceAvailable).toBe(true);
  });

  it("does not offer a reference when the current code no longer contains the evaluated expression", async () => {
    const { post } = await start({ rate: conceptThen(5, "Ja.") });
    const changed = IT064_SKETCH.replace("a & (1 << i) && 1", "bitRead(a, i)");
    const dialog = await openDialog(post, changed);
    // Without `1 << i` the concept question no longer applies, so the prediction question comes first.
    expect(dialog.state.question).toBe(IT064_PREDICTION_QUESTION);
    expect(dialog.state.support.referenceAvailable).toBe(false);
  });
});

describe("learning support over HTTP: typed inputs", () => {
  it("treats a typed question about the question as a clarification and 'Ich weiß nicht' as help, a short 1 as an answer", async () => {
    const { post } = await start({ rate: conceptThen(5, "Ja.") });
    const dialog = await toPredictionQuestion(post);

    const typed = await dialog.answer("Was ist mit dem ersten Durchlauf gemeint?");
    expect(typed.body).toMatchObject({ learnerInput: "clarification", question: IT064_PREDICTION_QUESTION });
    expect(typed.body.answerRating).toBeUndefined();
    expect(dialog.state.support).toMatchObject({ clarifications: 1, answerAttempts: 0 });

    const help = await dialog.answer("Ich weiß nicht");
    expect(help.body).toMatchObject({ learnerInput: "help", question: IT064_PREDICTION_QUESTION });
    expect(help.body.answerRating).toBeUndefined();
    expect(dialog.state.support).toMatchObject({ clarifications: 1, answerAttempts: 0 });

    const short = await dialog.answer("1");
    expect(short.body).toMatchObject({ learnerInput: "answer", answerRating: 5 });
  });
});

describe("learning support over HTTP: retries, concurrency, failures and ownership", () => {
  it("counts a repeated action once and returns the same result; a reused id with other data is a conflict", async () => {
    const { post, provider } = await start({ rate: conceptThen(1, "Nein.") });
    const dialog = await toPredictionQuestion(post);
    const calls = provider.generateLearningQuestion.mock.calls.length;
    const actionId = randomUUID();

    const first = await dialog.answer("7", { actionId });
    const handle = dialog.state.support.questionHandle;
    const repeated = await post("/api/tutor/dialog", {
      code: IT064_SKETCH, credential: "key", history: [], question: IT064_PREDICTION_QUESTION, answer: "7",
      courseContentSession: dialog.state.courseContentSession, supportSession: dialog.state.support.session, questionHandle: handle, actionId,
    });
    expect(repeated.body).toEqual(first.body);
    expect(repeated.body.support.answerAttempts).toBe(1);
    expect(provider.generateLearningQuestion.mock.calls).toHaveLength(calls + 1);

    const other = await post("/api/tutor/dialog", {
      code: IT064_SKETCH, credential: "key", history: [], question: IT064_PREDICTION_QUESTION, answer: "8",
      courseContentSession: dialog.state.courseContentSession, supportSession: dialog.state.support.session, questionHandle: handle, actionId,
    });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("SUPPORT_CONFLICT");
  });

  it("serializes parallel requests: the same action counts once, two different actions count twice", async () => {
    const { post } = await start();
    const dialog = await toPredictionQuestion(post);
    const actionId = randomUUID();
    const [a, b] = await Promise.all([dialog.act("clarify", { actionId }), dialog.act("clarify", { actionId })]);
    expect(a.body).toEqual(b.body);
    expect(b.body.support.clarifications).toBe(1);

    const [c, d] = await Promise.all([dialog.act("clarify"), dialog.act("clarify")]);
    expect([c.body.support.clarifications, d.body.support.clarifications].sort()).toEqual([2, 3]);
    expect(c.body.explanation).not.toBe(d.body.explanation);
  });

  it("does not count a failed provider call; the retry of the same action then counts once", async () => {
    const { post, script } = await start();
    const dialog = await toPredictionQuestion(post);
    const actionId = randomUUID();
    script.failNext = true;
    const failed = await dialog.act("clarify", { actionId });
    expect(failed.status).toBe(502);
    const retried = await dialog.act("clarify", { actionId });
    expect(retried.status).toBe(200);
    expect(retried.body.support.clarifications).toBe(1);
  });

  it("does not count a request the browser aborted before it was applied", async () => {
    let release!: () => void;
    const { post, script, provider, url } = await start();
    const dialog = await toPredictionQuestion(post);
    const calls = provider.generateLearningQuestion.mock.calls.length;
    script.delay = new Promise<void>((resolve) => { release = resolve; });
    const payload = JSON.stringify({
      code: IT064_SKETCH, credential: "key", history: [], action: "clarify", courseContentSession: dialog.state.courseContentSession, ...dialog.bind(),
    });
    const target = new URL("/api/tutor/support", url);
    const request = http.request({
      hostname: target.hostname, port: target.port, path: target.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, () => undefined);
    request.on("error", () => undefined);
    request.end(payload);
    try {
      await vi.waitFor(() => expect(provider.generateLearningQuestion.mock.calls).toHaveLength(calls + 1));
      const signal = provider.generateLearningQuestion.mock.calls[calls]?.[2] as AbortSignal;
      request.destroy();
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
    } finally {
      script.delay = undefined;
      release();
    }
    const next = await dialog.act("hint");
    expect(next.status).toBe(200);
    expect(next.body.support.clarifications).toBe(0);
  });

  it("rejects another subject's session, a stale question handle and client-supplied counters", async () => {
    const { post } = await start();
    const dialog = await toPredictionQuestion(post);
    const body = { code: IT064_SKETCH, credential: "key", history: [], action: "clarify", courseContentSession: dialog.state.courseContentSession };

    const foreign = await post("/api/tutor/support", { ...body, ...dialog.bind() }, { subject: "learner.b" });
    expect(foreign.status).toBe(400);
    const stale = await post("/api/tutor/support", { ...body, ...dialog.bind(), questionHandle: randomUUID() });
    expect(stale.body.error.code).toBe("SUPPORT_CONFLICT");
    const forged = await post("/api/tutor/support", { ...body, ...dialog.bind(), answerAttempts: 3 });
    expect(forged.status).toBe(400);
    const forgedReveal = await post("/api/tutor/support", { ...body, ...dialog.bind(), action: "reveal" });
    expect(forgedReveal.body.error.code).toBe("SUPPORT_LOCKED");
    expect(dialog.state.support).toMatchObject({ answerAttempts: 0, clarifications: 0 });
  });

  it("starts the counters over when the code changes, under a new question handle", async () => {
    const { post } = await start({ rate: conceptThen(1, "Nein.") });
    const dialog = await toPredictionQuestion(post);
    await dialog.answer("9");
    await dialog.answer("8");
    const handle = dialog.state.support.questionHandle;
    expect(dialog.state.support.answerAttempts).toBe(2);

    const changed = await dialog.answer("7", { code: IT064_SKETCH_A200 });
    expect(changed.status).toBe(200);
    expect(dialog.state.support.questionHandle).not.toBe(handle);
    expect(dialog.state.support).toMatchObject({ answerAttempts: 1, canRevealReference: false });
  });

  it("keeps the question's state when the dialog window loses older turns", async () => {
    const { post } = await start({ rate: conceptThen(1, "Nein.") });
    const dialog = await toPredictionQuestion(post);
    await dialog.answer("4");
    await dialog.answer("5");
    // The browser sends no history at all here; the server's count does not depend on it.
    await dialog.answer("6");
    expect(dialog.state.support).toMatchObject({ answerAttempts: 3, canRevealReference: true });
  });

  it("starts a new dialog with a new session; the old binding does not reach it", async () => {
    const { post } = await start();
    const first = await toPredictionQuestion(post);
    await first.act("clarify");
    const second = await openDialog(post);
    expect(second.state.support.session).not.toBe(first.state.support.session);
    expect(second.state.support).toMatchObject({ clarifications: 0, answerAttempts: 0 });
    const crossed = await post("/api/tutor/support", {
      code: IT064_SKETCH, credential: "key", history: [], action: "clarify", courseContentSession: second.state.courseContentSession,
      supportSession: second.state.support.session, questionHandle: first.state.support.questionHandle, actionId: randomUUID(),
    });
    expect(crossed.body.error.code).toBe("SUPPORT_CONFLICT");
  });
});

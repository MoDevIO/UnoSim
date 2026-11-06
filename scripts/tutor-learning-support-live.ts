import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { registerTutorRoutes } from "../server/routes/tutor.routes";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import type { LLMProvider, LLMProviderRequest } from "../server/services/tutor/llm-provider";
import { createTutorService } from "../server/services/tutor/tutor-service-factory";
import { TUTOR_PROMPT_REVISION } from "../server/services/tutor/tutor-service";
import {
  IT064_CONCEPT_QUESTION,
  IT064_PREDICTION_QUESTION,
  IT064_SKETCH,
  it064Content,
} from "../server/services/tutor/evaluation/learning-support-fixtures";

/**
 * Live evaluation of the learning-support cycle at the HTTP boundary (TutorQualityEvaluation 15,
 * LearningQuestions TUT-07/TUT-08): the production Tutor routes with the real provider, the IT06.4 Course
 * Content and the same request fields and session binding as the browser. Each sample replays the dialog,
 * carrying forward what the previous responses returned.
 *
 * The expected values come from the reviewed IT06.4 reference, computed independently of the Tutor model:
 * 1 << 7 = 128, 200 & 128 = 128, (200 & 128) && 1 is true, so the first print is 1.
 *
 * Usage: tsx scripts/tutor-learning-support-live.ts --output-dir <dir> [--samples 3] [--model auto]
 *        [--credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL]
 * Exit codes: 0 every check passed, 2 a check failed, 3 inconclusive (no valid credential or provider error).
 */

type Options = { samples: number; model: string; output: string | undefined; credentialEnv: string };

function parseOptions(argv: readonly string[]): Options {
  const options: Options = { samples: 3, model: "auto", output: undefined, credentialEnv: "UNOSIM_TUTOR_EVAL_CREDENTIAL" };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--samples") options.samples = Math.max(1, Math.min(10, Number.parseInt(value, 10)));
    else if (flag === "--model") options.model = value;
    else if (flag === "--output-dir") options.output = value;
    else if (flag === "--credential-env" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)) options.credentialEnv = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!options.output) throw new Error("--output-dir is required");
  return options;
}

/** Records the model's own result next to what the application delivered; nothing else changes. */
function promptKind(userPrompt: string): "dialog" | "question" | "support" {
  if (userPrompt.startsWith("Führe den sokratischen")) return "dialog";
  return userPrompt.startsWith("Erzeuge") ? "question" : "support";
}

function recordingProvider(inner: LLMProvider) {
  const raw: { readonly kind: string; readonly result: unknown; readonly model: string }[] = [];
  const provider: LLMProvider = {
    listModels: (credential, signal) => inner.listModels(credential, signal),
    async generateLearningQuestion(request: LLMProviderRequest, credential, signal) {
      const response = await inner.generateLearningQuestion(request, credential, signal);
      raw.push({ kind: promptKind(request.userPrompt), result: response.result, model: response.model });
      return response;
    },
  };
  return { provider, raw };
}

/**
 * `application` checks decide the outcome: what the learner receives. `model` checks are diagnostics of the
 * provider's own judgement, which the application corrects with the reviewed reference.
 */
type Check = { readonly id: string; readonly layer: "application" | "model"; readonly passed: boolean; readonly detail: string };

async function startServer(provider: LLMProvider) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.unosimIdentity = { subject: "eval.learning-support", roles: ["user"] };
    next();
  });
  registerTutorRoutes(app, {
    service: createTutorService(provider),
    courseContent: { resolveTutorContent: async () => it064Content() },
    disableRateLimit: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { server, post };
}

const COURSE = { repository: "ttbombadil/unosim-examples", ref: "main", revision: "6".repeat(40), exampleId: "it06-04-binaerzahl" };

/** One dialog as the browser runs it, from a new question to the IT06.4 prediction question. */
async function dialogAtPrediction(post: Awaited<ReturnType<typeof startServer>>["post"], credential: string, model: string, log: unknown[]) {
  const modelField = model === "auto" ? {} : { model };
  const first = await post("/api/tutor/question", { code: IT064_SKETCH, credential, ...modelField, courseContent: COURSE, learningSupport: true });
  log.push({ step: "question", status: first.status, body: first.body });
  if (first.status !== 200) throw Object.assign(new Error(`question request failed with ${first.status}`), { response: first });
  const state = { question: first.body.question as string, support: first.body.support, session: first.body.courseContentSession as string, model: first.body.model as string };
  const answer = async (text: string) => {
    const response = await post("/api/tutor/dialog", {
      code: IT064_SKETCH, credential, ...modelField, history: [], question: state.question, answer: text, courseContentSession: state.session,
      supportSession: state.support.session, questionHandle: state.support.questionHandle, actionId: randomUUID(),
    });
    log.push({ step: "answer", answer: text, status: response.status, body: response.body });
    if (response.status === 200) {
      state.question = response.body.question;
      state.support = response.body.support;
    }
    return response;
  };
  const act = async (action: string) => {
    const response = await post("/api/tutor/support", {
      code: IT064_SKETCH, credential, ...modelField, history: [], action, courseContentSession: state.session,
      supportSession: state.support.session, questionHandle: state.support.questionHandle, actionId: randomUUID(),
    });
    log.push({ step: action, status: response.status, body: response.body });
    if (response.status === 200 && response.body.support) state.support = response.body.support;
    return response;
  };
  if (state.question === IT064_CONCEPT_QUESTION) {
    // The concept question first: a complete answer; if the model keeps the question, skip it by two clarifications.
    await answer("Sie bildet eine Maske, in der nur Bit i gesetzt ist; a & (1 << i) prüft damit genau dieses Bit von a.");
    if (state.question === IT064_CONCEPT_QUESTION) {
      await act("clarify");
      await act("clarify");
      const skipped = await act("skip");
      if (skipped.body.next) state.question = skipped.body.next.question;
    }
  }
  return { state, answer, act };
}

/** Feedback that calls a correct answer wrong, or names the solution in a clarification. */
const CALLS_WRONG = /\b(falsch|nicht\s+(?:richtig|korrekt)|stimmt\s+nicht|0\s+ausgegeben|wird\s+0)\b/i;
const NAMES_RESULT = [
  /gibt\s+(?:eine\s+)?1\s+aus/i,
  /ausgegeben\s+wird\s+(?:eine\s+)?1\b/i,
  /200\s*=\s*1\b/,
  /(?:ergebnis|antwort)\s+ist\s+1\b/i,
];
const namesResult = (text: string) => NAMES_RESULT.some((pattern) => pattern.test(text));

type Post = Awaited<ReturnType<typeof startServer>>["post"];
type Raw = ReturnType<typeof recordingProvider>["raw"];
type CheckFn = (id: string, passed: boolean, detail: string) => void;
const layerOf = (id: string): Check["layer"] => (id.startsWith("model-") ? "model" : "application");

function lastModelRating(raw: Raw): { readonly rating?: number; readonly feedback?: string } {
  const last = [...raw].reverse().find(({ kind }) => kind === "dialog")?.result as { answerRating?: number; feedback?: string } | undefined;
  return { rating: last?.answerRating, feedback: last?.feedback };
}

/** Grades 1, 200 = 1 and 0, each in a dialog of its own: the model's own rating and the delivered one. */
async function checkGrading(post: Post, credential: string, model: string, raw: Raw, log: unknown[], check: CheckFn): Promise<void> {
  for (const [answerText, correct] of [["1", true], ["200 = 1", true], ["0", false]] as const) {
    const dialog = await dialogAtPrediction(post, credential, model, log);
    check(`reach-prediction:${answerText}`, dialog.state.question === IT064_PREDICTION_QUESTION, dialog.state.question);
    if (dialog.state.question !== IT064_PREDICTION_QUESTION) continue;
    const response = await dialog.answer(answerText);
    const modelView = lastModelRating(raw);
    const rating = response.body.answerRating as number | undefined;
    const feedback = String(response.body.feedback ?? "");
    const modelDetail = `model rating ${modelView.rating}: ${modelView.feedback}`;
    const appDetail = `rating ${rating}: ${feedback}`;
    if (correct) {
      check(`model-accepts:${answerText}`, (modelView.rating ?? 0) >= 4 && !CALLS_WRONG.test(modelView.feedback ?? ""), modelDetail);
      check(`application-accepts:${answerText}`, (rating ?? 0) >= 4 && !CALLS_WRONG.test(feedback), appDetail);
    } else {
      check(`model-rejects:${answerText}`, (modelView.rating ?? 5) <= 2, modelDetail);
      check(`application-rejects:${answerText}`, (rating ?? 5) <= 2 && response.body.question === IT064_PREDICTION_QUESTION, appDetail);
    }
  }
}

/** Two clarifications, three own answers and the reference answer on one prediction question. */
async function checkSupportCycle(post: Post, credential: string, model: string, log: unknown[], check: CheckFn): Promise<void> {
  const dialog = await dialogAtPrediction(post, credential, model, log);
  if (dialog.state.question !== IT064_PREDICTION_QUESTION) {
    check("reach-prediction:support", false, dialog.state.question);
    return;
  }
  const first = await dialog.act("clarify");
  const second = await dialog.act("clarify");
  const explanations = [first.body.explanation, second.body.explanation].map(String);
  check("clarify-counts", dialog.state.support?.clarifications === 2 && dialog.state.support?.answerAttempts === 0, JSON.stringify(dialog.state.support));
  check("clarify-hides-result", explanations.every((text) => !namesResult(text)), explanations.join(" | "));
  check("clarify-second-differs", explanations[0] !== explanations[1], explanations.join(" | "));
  check("skip-unlocked-reference-locked", dialog.state.support?.canSkip === true && dialog.state.support?.canRevealReference === false, JSON.stringify(dialog.state.support));
  for (const wrong of ["0", "2", "128"]) await dialog.answer(wrong);
  check("three-attempts-unlock", dialog.state.support?.answerAttempts === 3 && dialog.state.support?.canRevealReference === true, JSON.stringify(dialog.state.support));
  const revealed = await dialog.act("reveal");
  check("reveal-reference", revealed.body.reference?.status === "available" && revealed.body.reference?.answer === "1", JSON.stringify(revealed.body.reference));
}

async function runSample(post: Post, credential: string, model: string, raw: Raw) {
  const log: unknown[] = [];
  const checks: Check[] = [];
  const check: CheckFn = (id, passed, detail) => checks.push({ id, layer: layerOf(id), passed, detail });
  await checkGrading(post, credential, model, raw, log, check);
  await checkSupportCycle(post, credential, model, log, check);
  return { log, checks, models: [...new Set(raw.map(({ model: used }) => used))] };
}

type Outcome = "pass" | "fail" | "inconclusive";

function technicalFailure(error: unknown): string {
  const response = (error as { response?: { status: number; body: { error?: { code?: string } } } }).response;
  if (!response) return String(error);
  return `${response.status} ${response.body.error?.code ?? ""}`.trim();
}

function sampleSummary(sample: number, checks: readonly Check[]): string {
  const application = checks.filter(({ layer }) => layer === "application");
  const failed = application.filter(({ passed }) => !passed).map(({ id }) => id);
  const model = checks.filter(({ layer }) => layer === "model");
  const modelFailed = model.filter(({ passed }) => !passed).map(({ id }) => id);
  const summary = `sample ${sample}: application ${application.length - failed.length}/${application.length}`;
  const failedPart = failed.length === 0 ? "" : ` (failed: ${failed.join(", ")})`;
  const modelPart = `; model ${model.length - modelFailed.length}/${model.length}${modelFailed.length === 0 ? "" : ` (wrong: ${modelFailed.join(", ")})`}`;
  return summary + failedPart + modelPart;
}

/** A provider error in any step makes the sample technical: it says nothing about the application's behavior. */
function providerFailure(log: readonly unknown[]): string | undefined {
  const failed = log.find((entry) => ((entry as { status?: number }).status ?? 0) >= 500) as { status: number; body?: { error?: { code?: string } } } | undefined;
  return failed ? `${failed.status} ${failed.body?.error?.code ?? ""}`.trim() : undefined;
}

/** Runs every sample; a failed check makes the run fail, a technical failure inconclusive. */
async function runSamples(options: Options, credential: string, report: Record<string, unknown>): Promise<{ readonly outcome: Outcome; readonly models: readonly string[] }> {
  const { provider, raw } = recordingProvider(new KiconnectProvider());
  const { server, post } = await startServer(provider);
  const samples = report.samples as unknown[];
  let outcome: Outcome = "pass";
  try {
    for (let sample = 1; sample <= options.samples; sample += 1) {
      try {
        const result = await runSample(post, credential, options.model, raw);
        const technical = providerFailure(result.log);
        samples.push({ sample, ...(technical ? { technicalFailure: technical } : {}), ...result });
        console.log(technical ? `sample ${sample}: technical failure ${technical} during the dialog` : sampleSummary(sample, result.checks));
        if (technical) {
          if (outcome !== "fail") outcome = "inconclusive";
        } else if (result.checks.some(({ layer, passed }) => layer === "application" && !passed)) {
          outcome = "fail";
        }
      } catch (error) {
        const failure = technicalFailure(error);
        samples.push({ sample, technicalFailure: failure });
        console.log(`sample ${sample}: technical failure ${failure}`);
        if (outcome !== "fail") outcome = "inconclusive";
      }
    }
  } finally {
    server.close();
  }
  return { outcome, models: [...new Set(raw.map(({ model }) => model))] };
}

const EXIT_CODES: Readonly<Record<Outcome, number>> = { pass: 0, fail: 2, inconclusive: 3 };

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const credential = process.env[options.credentialEnv]?.trim();
  const report: Record<string, unknown> = {
    evidence: "http-live",
    startedAt: new Date().toISOString(),
    requestedModel: options.model,
    promptRevision: TUTOR_PROMPT_REVISION.id,
    case: "IT06.4 prediction question with a = 200 (LearningQuestions R-SUP-8)",
    referenceProvenance: "server/services/tutor/evaluation/learning-support-fixtures.ts, computed by hand: 1 << 7 = 128, 200 & 128 = 128, 128 && 1 -> 1",
    samples: [],
  };
  const outputDir = options.output!;
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `report-${Date.now()}.json`);
  if (!credential) {
    report.outcome = "inconclusive";
    report.reason = `${options.credentialEnv} is not set`;
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`inconclusive: ${options.credentialEnv} is not set; report ${reportPath}`);
    return EXIT_CODES.inconclusive;
  }
  const { outcome, models } = await runSamples(options, credential, report);
  report.returnedModels = models;
  report.outcome = outcome;
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`${outcome}; models ${JSON.stringify(models)}; report ${reportPath}`);
  return EXIT_CODES[outcome];
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

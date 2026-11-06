import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadTutorQualityEvaluationScenarios } from "../../../../../scripts/tutor-quality-real-provider-eval";
import {
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
  type TutorQualityTranscript,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import { buildJudgeInput } from "../../../../../server/services/tutor/evaluation/judge";
import { IT064_CONCEPT_QUESTION, IT064_SKETCH } from "../../../../../server/services/tutor/evaluation/learning-support-fixtures";
import type { LLMProvider, LLMProviderRequest } from "../../../../../server/services/tutor/llm-provider";

/**
 * L2 evidence of the learning-support extension of the evaluation (Evaluation SSOT 15, R-SUP-E4): the real
 * corpus scenarios replayed over the production Tutor routes with a scripted provider. A scripted rating
 * proves the evaluation's mechanics, never the model's grading.
 */

const CREDENTIAL = "evaluation-secret-credential";

function promptPart(prompt: string, label: string): string {
  const start = prompt.indexOf(label);
  if (start < 0) return "";
  const from = start + label.length;
  const end = prompt.indexOf("\n", from);
  return prompt.slice(from, end < 0 ? undefined : end);
}

interface Script {
  /** The model's own rating of an answer to the prediction question. */
  readonly rate: (answer: string) => 1 | 2 | 3 | 4 | 5;
  readonly conceptRating?: 1 | 2 | 3 | 4 | 5;
  readonly explanation?: string;
  readonly failSupport?: boolean;
}

const EXPLANATIONS = [
  "Gemeint ist der erste Schleifendurchlauf mit i = 7.",
  "Schau nur auf den Serial.print-Aufruf innerhalb der Schleife: Gesucht ist ein einzelnes Zeichen.",
];

function scriptedProvider(script: Script): LLMProvider {
  let explanations = 0;
  return {
    async listModels() {
      return ["fake-model", "judge-model"];
    },
    async generateLearningQuestion({ userPrompt }: LLMProviderRequest) {
      if (userPrompt.startsWith("Führe den sokratischen Lerndialog")) {
        const answer = promptPart(userPrompt, "Aktuelle Nutzerantwort:\n```text\n");
        const question = promptPart(userPrompt, "Aktuelle Tutorfrage:\n");
        const rating = question === IT064_CONCEPT_QUESTION ? (script.conceptRating ?? 5) : script.rate(answer);
        return { model: "fake-model", result: { responseStyle: "normal" as const, feedback: rating >= 4 ? "Richtig." : "Noch nicht.", answerRating: rating, question: "Was gibt der zweite Durchlauf aus?" } };
      }
      if (userPrompt.startsWith("Erzeuge eine einzige Lernfrage")) {
        return { model: "fake-model", result: { responseStyle: "normal" as const, question: "Welche Rolle spielt Serial.begin im Sketch?" } };
      }
      if (script.failSupport) throw Object.assign(new Error("timeout"), { kind: "timeout" });
      return { model: "fake-model", result: { responseStyle: "normal" as const, feedback: script.explanation ?? EXPLANATIONS[explanations++ % EXPLANATIONS.length], question: promptPart(userPrompt, "Aktuelle Frage:\n") } };
    },
  };
}

async function corpusScenario(id: string): Promise<TutorQualityEvaluationScenario> {
  const scenarios = await loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml");
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`missing scenario ${id}`);
  return scenario;
}

async function run(id: string, script: Script, samples = 1) {
  return runTutorQualityEvaluation({
    scenarios: [await corpusScenario(id)],
    provider: scriptedProvider(script),
    providerId: "fake-provider",
    credential: CREDENTIAL,
    requestedModel: "fake-model",
    samples,
    maxCalls: 100,
    git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
    artifactWriter: async () => undefined,
  });
}

const checks = (transcript: TutorQualityTranscript | undefined, name: string) =>
  transcript?.turns.flatMap(({ deterministicChecks }) => deterministicChecks).filter((check) => check.name === name) ?? [];

describe("learning-support scenarios over HTTP (R-SUP-E4)", () => {
  it("keeps the IT06.4 sketch fixture identical to the reviewed program, so the reference applies", async () => {
    expect(await readFile("evals/tutor-quality/fixtures/it06-4-binaerzahl.ino", "utf8")).toBe(IT064_SKETCH);
  });

  it("reports the application's corrected rating apart from the model's own rating, as http-route evidence", async () => {
    const { report, transcripts } = await run("TQ-SUP-IT064-ANSWER-1", { rate: () => 1 });
    const transcript = transcripts[0];
    expect(transcript?.executionStatus).toBe("completed");
    expect(checks(transcript, "expected-answer-rating")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    expect(checks(transcript, "raw-provider-answer-rating")).toEqual([expect.objectContaining({ outcome: "fail" })]);
    expect(checks(transcript, "expected-learner-input")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    const aggregate = report.byScenario["TQ-SUP-IT064-ANSWER-1"];
    expect(aggregate).toMatchObject({ executionEvidence: "http-route", completed: 1, technicalFailures: 0 });
    expect(aggregate?.referenceProvenance).toContain("200 & 128 = 128");
    expect(aggregate?.checkLayers.rawModel.fail).toBeGreaterThan(0);
    expect(aggregate?.checkLayers.application.fail).toBe(0);
    expect(aggregate?.turnDurationsMs).toHaveLength(3);
    // The turn records the asked question and the support transition; the credential never appears.
    // A correct answer moves on: the support state after the turn is the next question's.
    expect(transcript?.turns[2]).toMatchObject({ httpStatus: 200, askedQuestion: expect.stringContaining("Durchlauf"), supportBefore: { answerAttempts: 0 }, supportAfter: { answerAttempts: 0 } });
    expect(transcript?.turns[2]?.supportAfter?.questionHandle).not.toBe(transcript?.turns[2]?.supportBefore?.questionHandle);
    expect(JSON.stringify(transcripts)).not.toContain(CREDENTIAL);
  });

  it("counts two clarifications without attempts, unlocks skipping only, and makes the clarification judge-eligible", async () => {
    const { report, transcripts } = await run("TQ-SUP-IT064-CLARIFY", { rate: () => 5 });
    const transcript = transcripts[0]!;
    expect(transcript.executionStatus).toBe("completed");
    expect(checks(transcript, "expected-support-state")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    expect(checks(transcript, "final-tutor-no-declared-leak").every(({ outcome }) => outcome === "pass")).toBe(true);
    expect(report.byScenario["TQ-SUP-IT064-CLARIFY"]?.supportActions).toEqual({ clarify: 2 });
    const scenario = await corpusScenario("TQ-SUP-IT064-CLARIFY");
    expect(buildJudgeInput(scenario, transcript)).toMatchObject({
      learnerAnswer: "Ich bitte darum, die Frage verständlicher zu erklären.",
      tutor: { feedback: EXPLANATIONS[1] },
    });
  });

  it("finds a clarification that reveals the result, in the raw and in the delivered output", async () => {
    const { transcripts } = await run("TQ-SUP-IT064-CLARIFY", { rate: () => 5, explanation: "Im ersten Durchlauf ist das Ergebnis ist 1, rechne nach." });
    const transcript = transcripts[0]!;
    expect(transcript.invariantViolations.map(({ code, source }) => `${source}:${code}`)).toEqual(expect.arrayContaining(["raw-provider:solution-revealed"]));
  });

  it("expects an early reveal to be refused, and shows the reference answer after three own answers", async () => {
    const early = await run("TQ-SUP-IT064-EARLY-REVEAL", { rate: () => 1 });
    expect(early.transcripts[0]?.executionStatus).toBe("completed");
    expect(checks(early.transcripts[0], "expected-action-rejected")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    expect(early.transcripts[0]?.invariantViolations).toEqual([]);

    const reveal = await run("TQ-SUP-IT064-REVEAL", { rate: () => 1 });
    const transcript = reveal.transcripts[0]!;
    expect(transcript.executionStatus).toBe("completed");
    expect(checks(transcript, "expected-reference-answer")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    expect(checks(transcript, "reveal-was-unlocked")).toEqual([expect.objectContaining({ outcome: "pass" })]);
    // An authorized reveal is no leak, and it is not judged.
    expect(transcript.invariantViolations).toEqual([]);
    expect(buildJudgeInput(await corpusScenario("TQ-SUP-IT064-REVEAL"), transcript)).toBeUndefined();
  });

  it("reports an unexpected question as a binding problem instead of answering it", async () => {
    const { report, transcripts } = await run("TQ-SUP-IT064-ANSWER-1", { rate: () => 5, conceptRating: 1 });
    expect(transcripts[0]).toMatchObject({ executionStatus: "invalid", invalidReason: "question-binding-mismatch" });
    expect(report.byScenario["TQ-SUP-IT064-ANSWER-1"]?.invalid).toBe(1);
  });

  it("reports a provider failure as a technical failure, not as a quality result", async () => {
    const { report, transcripts } = await run("TQ-SUP-IT064-CLARIFY", { rate: () => 5, failSupport: true });
    expect(transcripts[0]?.executionStatus).toBe("technical-failure");
    expect(report.byScenario["TQ-SUP-IT064-CLARIFY"]?.technicalFailures).toBe(1);
    expect(report.qualityVerdict.verdict).not.toBe("fail");
  });
});

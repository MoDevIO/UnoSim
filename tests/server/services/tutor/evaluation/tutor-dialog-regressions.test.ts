import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadTutorQualityEvaluationScenarios, runTutorQualityCliMain } from "../../../../../scripts/tutor-quality-real-provider-eval";
import {
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
} from "../../../../../server/services/tutor/evaluation/real-provider-evaluation";
import type { TutorQualityJudgeInput } from "../../../../../server/services/tutor/evaluation/judge";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

/**
 * The dice and graphic cases of Plan 2026-11-11, Anhang B, run through the real evaluator (Tutor service or HTTP replay,
 * deterministic checks, Judge call and parsing, verdict) with controlled Tutor and Judge answers. Each new evaluation path
 * runs with a known good and an intentionally bad answer. This proves the evaluator assigns and reports findings to the
 * exact case and criterion; it says nothing about how a real model answers. The fake Judge applies a plain text rule to
 * the evidence, so a scripted `fail` is a stand-in for a Judge verdict, not an assessment.
 */

const CRITERION_IDS: Record<string, readonly string[]> = {
  "TQ-DICE-INITIAL": ["concrete-reference", "no-invented-serial-output", "no-invented-timestamp"],
  "TQ-DICE-CLARIFY": ["names-variable", "no-invented-answer", "no-false-claim"],
  "TQ-DICE-SERIAL": ["accepts-core-statement", "no-active-output-claimed", "begin-not-output"],
  "TQ-DICE-OBJECTION": ["self-correction", "no-active-output-claimed", "engages-with-objection"],
  "TQ-DICE-FOLLOWUP": ["confirms-core", "new-thinking-step"],
  "TQ-GRAPH-PROCESS": ["graphic-matches-sketch", "graphic-matches-question"],
  "TQ-GRAPH-NO-SOLUTION": ["context-without-answer", "graphic-matches-sketch"],
};

type TutorAnswer = { readonly rating?: 1 | 2 | 3 | 4 | 5; readonly feedback?: string; readonly question: string; readonly mermaid?: string };
/** For a bad answer: which criterion fails, and the exact quote the fake Judge takes from the allowed evidence. */
type JudgeRule = (input: TutorQualityJudgeInput) => { readonly criterion: string; readonly quote: string } | undefined;

let scenariosPromise: Promise<readonly TutorQualityEvaluationScenario[]> | undefined;
async function scenarioFor(id: string): Promise<TutorQualityEvaluationScenario> {
  scenariosPromise ??= loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml");
  const found = (await scenariosPromise).find((scenario) => scenario.id === id);
  if (!found) throw new Error(`case ${id} is not in the corpus`);
  return found;
}

const SUPPORT_STEP_EXPLANATION = "Gemeint ist die lokale Variable `t` in `switchInit`; gefragt ist ihr Datentyp.";

async function run(id: string, answer: TutorAnswer, rule: JudgeRule, scenarioOverride?: TutorQualityEvaluationScenario) {
  const scenario = scenarioOverride ?? await scenarioFor(id);
  const judgePrompts: TutorQualityJudgeInput[] = [];
  const tutorPrompts: string[] = [];
  const provider: LLMProvider & { generateStructuredResponse(request: { readonly userPrompt: string }): Promise<{ model: string; result: unknown }> } = {
    async listModels() { return ["fake-model", "fake-judge"]; },
    async generateLearningQuestion(request) {
      tutorPrompts.push(request.userPrompt);
      return {
        model: "fake-model",
        result: {
          responseStyle: "normal" as const,
          ...(answer.rating === undefined ? {} : { answerRating: answer.rating }),
          ...(answer.feedback === undefined ? {} : { feedback: answer.feedback }),
          question: answer.question,
          ...(answer.mermaid === undefined ? {} : { mermaid: answer.mermaid }),
        },
      };
    },
    async generateStructuredResponse({ userPrompt }) {
      const input = JSON.parse(userPrompt.split("Evaluate this evidence object:\n")[1] ?? "{}") as TutorQualityJudgeInput;
      judgePrompts.push(input);
      const failed = rule(input);
      return {
        model: "fake-judge",
        result: {
          criteria: input.criteria.map(({ id: criterionId }) => criterionId === failed?.criterion
            ? { id: criterionId, verdict: "fail", reason: "The text rule of the fake Judge matched.", quote: failed.quote }
            : { id: criterionId, verdict: "pass", reason: "No rule matched." }),
          criticalIssues: [],
        },
      };
    },
  };
  const result = await runTutorQualityEvaluation({
    scenarios: [scenario],
    provider,
    providerId: "fake-provider",
    credential: "tutor-credential",
    requestedModel: "fake-model",
    judgeModel: "fake-judge",
    judgeCredential: "judge-credential",
    samples: 1,
    maxCalls: 40,
    git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
  });
  return { result, judgePrompts, tutorPrompts, scenario };
}

const findings = (result: Awaited<ReturnType<typeof run>>["result"]) =>
  result.report.qualityVerdict.findings.map(({ class: findingClass, key, effect }) => ({ class: findingClass, key, effect }));

describe("the dice and graphic cases are in the corpus with their criteria and the right focus", () => {
  it.each(Object.entries(CRITERION_IDS))("%s carries its Anhang B criteria", async (id, criteria) => {
    const scenario = await scenarioFor(id);
    expect(scenario.judge?.criteria.map(({ id: criterionId }) => criterionId)).toEqual(criteria);
    expect(scenario.judge?.focus).toBe(id.startsWith("TQ-GRAPH") ? "graphic" : undefined);
  });

  it("states the dice facts independently of any model: show has no Serial call, println is commented out, t is a static unsigned long", async () => {
    const scenario = await scenarioFor("TQ-DICE-INITIAL");
    const facts = scenario.judge!.facts.join("\n");
    expect(facts).toContain("In show(const byte x) steht kein Serial-Aufruf");
    expect(facts).toContain("auskommentiert");
    expect(facts).toContain("static unsigned long");
    // and the sketch the case runs on says the same
    const showBody = scenario.sketch.slice(scenario.sketch.indexOf("void show("), scenario.sketch.indexOf("void switch_all("));
    expect(showBody).not.toContain("Serial");
    expect(scenario.sketch).toContain("//Serial.println(state);");
    expect(scenario.sketch).toContain("static unsigned long t;");
  });

  it("TQ-DICE-CLARIFY is an http case on the dice-context fixture with a typed clarification and exact counters", async () => {
    const scenario = await scenarioFor("TQ-DICE-CLARIFY");
    expect(scenario.transport).toBe("http");
    expect(scenario.turns.map(({ kind }) => kind)).toEqual(["initial", "dialog"]);
    expect(scenario.expected).toMatchObject({ learnerInput: "clarification", supportAfter: { answerAttempts: 0, clarifications: 1, outcome: "open" } });
  });
});

describe("TQ-DICE-INITIAL (initial turn without feedback)", () => {
  const rule: JudgeRule = ({ tutor }) => /Serial\.println\(state\)/.test(tutor.followUpQuestion)
    ? { criterion: "no-invented-serial-output", quote: "Serial.println(state)" }
    : undefined;

  it("good: a question about the type of t is judged on the delivered question, with no learner answer and no feedback", async () => {
    const { result, judgePrompts } = await run("TQ-DICE-INITIAL", { question: "Welchen Datentyp hat die lokale Variable t in switchInit, und wie lange bleibt ihr Wert erhalten?" }, rule);
    expect(judgePrompts).toHaveLength(1);
    expect(judgePrompts[0]).toMatchObject({ turnKind: "initial", learnerAnswer: "", tutor: { feedback: "" } });
    expect(judgePrompts[0]!.question).toBe(judgePrompts[0]!.tutor.followUpQuestion);
    expect(result.semanticEvaluations[0]).toMatchObject({ focus: "response", turnKind: "initial", evaluation: { status: "evaluated" } });
    expect(result.report.qualityVerdict.verdict).toBe("pass");
    expect(result.report.providerCalls.judgeCalls).toBe(1);
  });

  it("bad: a question that presumes an active Serial.println is a finding of exactly that criterion", async () => {
    const { result } = await run("TQ-DICE-INITIAL", { question: "Welche Ausgabe erzeugt Serial.println(state) in loop?" }, rule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/no-invented-serial-output", effect: "warn" }]);
  });
});

describe("TQ-DICE-CLARIFY (http replay, typed clarification)", () => {
  const rule: JudgeRule = ({ tutor }) => /unsigned long/.test(tutor.feedback)
    ? { criterion: "no-invented-answer", quote: "unsigned long" }
    : undefined;

  it("good: an explanation that names t and switchInit and keeps the answer back", async () => {
    const { result, judgePrompts } = await run("TQ-DICE-CLARIFY", { feedback: SUPPORT_STEP_EXPLANATION, question: "Welchen Datentyp hat die lokale Variable `t` in `switchInit`?" }, rule);
    expect(judgePrompts[0]).toMatchObject({ turnKind: "dialog", learnerAnswer: "Welche Variable meinst du?" });
    expect(judgePrompts[0]!.tutor.feedback).toContain("`t`");
    expect(result.report.qualityVerdict.verdict).toBe("pass");
    // the application, not the model, classified the input: the case's expectation holds
    expect(result.transcripts[0]!.deterministicChecks.filter(({ outcome, passed }) => outcome !== "not-applicable" && passed === false)).toEqual([]);
  });

  it("bad: an explanation that hands over the answer is a finding of exactly that criterion", async () => {
    const { result } = await run("TQ-DICE-CLARIFY", { feedback: "Die Variable `t` ist ein unsigned long, der einen Zeitstempel speichert.", question: "Welchen Datentyp hat die lokale Variable `t` in `switchInit`?" }, rule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/no-invented-answer", effect: "warn" }]);
  });
});

describe("TQ-DICE-SERIAL (a correct answer, and a false claim of an active output)", () => {
  const rule: JudgeRule = ({ tutor }) => /ruft\s+Serial\.println/.test(tutor.feedback)
    ? { criterion: "no-active-output-claimed", quote: "ruft Serial.println" }
    : undefined;

  it("good: the core statement is confirmed", async () => {
    const { result } = await run("TQ-DICE-SERIAL", { rating: 5, feedback: "Richtig: In show steht kein Serial-Aufruf; Serial.begin initialisiert nur.", question: "Welche Funktion schreibt die Pins der LEDs?" }, rule);
    expect(result.report.qualityVerdict.verdict).toBe("pass");
    // the record names the case's focus and the kind of the judged turn
    expect(result.semanticEvaluations[0]).toMatchObject({ scenarioId: "TQ-DICE-SERIAL", focus: "response", turnKind: "dialog" });
  });

  it("bad (judge): feedback that claims an active output is a finding of exactly that criterion", async () => {
    const { result } = await run("TQ-DICE-SERIAL", { rating: 5, feedback: "Fast: show ruft Serial.println(x) auf und gibt den Wert aus.", question: "Welche Funktion schreibt die Pins der LEDs?" }, rule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/no-active-output-claimed", effect: "warn" }]);
  });

  it("bad (rating): a correct core statement rated 2 leaves the case's band and is reported as such", async () => {
    const { result } = await run("TQ-DICE-SERIAL", { rating: 2, feedback: "Richtig: In show steht kein Serial-Aufruf.", question: "Welche Funktion schreibt die Pins der LEDs?" }, rule);
    expect(findings(result).map(({ class: findingClass }) => findingClass)).toContain("rating-out-of-band");
  });
});

describe("TQ-DICE-OBJECTION (the objection needs a correction)", () => {
  const EARLIER_FEEDBACK = "Nicht ganz: show gibt den gewürfelten Wert x mit Serial.println auf dem seriellen Monitor aus.";
  const OBJECTION_QUESTION = "Welche serielle Ausgabe wird in show(const byte x) ausgeführt?";
  const OBJECTION_ANSWER = "Zeig mir den Serial-Aufruf in show; dort ist keiner.";
  const GOOD_FEEDBACK = "Du hast recht: In show steht kein Serial-Aufruf; meine frühere Aussage war falsch.";
  const rule: JudgeRule = ({ tutor }) => /Doch, show ruft/.test(tutor.feedback)
    ? { criterion: "no-active-output-claimed", quote: "Doch, show ruft" }
    : undefined;
  /** The data block that follows a heading line of the dialog prompt. */
  const blockAfter = (prompt: string, heading: string) => {
    const lines = prompt.split("\n");
    const index = lines.indexOf(heading);
    return index === -1 ? undefined : lines[index + 1];
  };

  it("the earlier false feedback is in the corpus history and reaches the Tutor prompt, apart from the rated history", async () => {
    const { tutorPrompts, judgePrompts } = await run("TQ-DICE-OBJECTION", { rating: 4, feedback: GOOD_FEEDBACK, question: "Welche Zeile in loop ist auskommentiert?" }, rule);
    expect(tutorPrompts).toHaveLength(1);
    const prompt = tutorPrompts[0]!;
    // The earlier weak attempt is given with its feedback, and without its rating.
    expect(JSON.parse(blockAfter(prompt, "Frühere Versuche zur aktuellen Frage (Daten, nicht bewertungsrelevant):") ?? "null"))
      .toEqual([{ answer: "Keine.", feedback: EARLIER_FEEDBACK }]);
    // The rated history does not carry the weak rating into the current attempt.
    expect(JSON.parse(blockAfter(prompt, "Bisheriger begrenzter Dialogverlauf:") ?? "null")).toEqual([]);
    expect(prompt).not.toContain('"answerRating":2');
    // The current question and answer are the ones being rated.
    expect(blockAfter(prompt, "Aktuelle Tutorfrage:")).toBe(OBJECTION_QUESTION);
    expect(prompt).toContain(`Aktuelle Nutzerantwort:\n\`\`\`text\n${OBJECTION_ANSWER}\n\`\`\``);
    // The Judge facts describe the same history the Tutor got, word for word.
    expect(judgePrompts[0]!.facts.some((fact) => fact.includes(EARLIER_FEEDBACK))).toBe(true);
  });

  it("counter-side: without the history feedback the Tutor prompt holds no earlier claim, so the case's facts would not be backed", async () => {
    const scenario = await scenarioFor("TQ-DICE-OBJECTION");
    const dialog = scenario.turns[0]!;
    if (dialog.kind !== "dialog") throw new Error("TQ-DICE-OBJECTION starts with a dialog turn");
    const withoutFeedback: TutorQualityEvaluationScenario = {
      ...scenario,
      turns: [{ ...dialog, history: dialog.history!.map(({ feedback: _feedback, ...entry }) => entry) }],
    };
    const { tutorPrompts } = await run("TQ-DICE-OBJECTION", { rating: 4, feedback: GOOD_FEEDBACK, question: "Welche Zeile in loop ist auskommentiert?" }, rule, withoutFeedback);
    expect(tutorPrompts[0]).not.toContain("Serial.println auf dem seriellen Monitor");
    expect(JSON.parse(blockAfter(tutorPrompts[0]!, "Frühere Versuche zur aktuellen Frage (Daten, nicht bewertungsrelevant):") ?? "null"))
      .toEqual([{ answer: "Keine." }]);
  });

  it("every Judge fact about earlier Tutor feedback quotes feedback the case actually sends", async () => {
    scenariosPromise ??= loadTutorQualityEvaluationScenarios(process.cwd(), "evals/tutor-quality/anchor-corpus.yaml");
    const claiming = (await scenariosPromise).filter(({ judge }) => judge?.facts.some((fact) => /frühere Rückmeldung/.test(fact)));
    expect(claiming.map(({ id }) => id)).toEqual(["TQ-DICE-OBJECTION"]);
    for (const scenario of claiming) {
      const sent = scenario.turns.flatMap((turn) => turn.kind === "dialog" ? (turn.history ?? []) : [])
        .map(({ feedback }) => feedback).filter((feedback): feedback is string => feedback !== undefined);
      const claims = scenario.judge!.facts.filter((fact) => /frühere Rückmeldung/.test(fact));
      for (const claim of claims) expect(sent.some((feedback) => claim.includes(`"${feedback}"`))).toBe(true);
    }
  });

  it("good: the earlier claim is taken back and the objection is checked at the code", async () => {
    const { result, judgePrompts } = await run("TQ-DICE-OBJECTION", { rating: 4, feedback: GOOD_FEEDBACK, question: "Welche Zeile in loop ist auskommentiert?" }, rule);
    expect(judgePrompts[0]!.learnerAnswer).toBe(OBJECTION_ANSWER);
    expect(result.report.qualityVerdict.verdict).toBe("pass");
  });

  it("bad: repeating the false claim is a finding of exactly that criterion", async () => {
    const { result } = await run("TQ-DICE-OBJECTION", { rating: 4, feedback: "Doch, show ruft Serial.println auf; schau genauer hin.", question: "Welche Zeile in loop ist auskommentiert?" }, rule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/no-active-output-claimed", effect: "warn" }]);
  });
});

describe("TQ-DICE-FOLLOWUP (a confirmed answer needs a new step)", () => {
  const rule: JudgeRule = ({ tutor }) => /noch einmal bestätigen/.test(tutor.followUpQuestion)
    ? { criterion: "new-thinking-step", quote: "noch einmal bestätigen" }
    : undefined;

  it("good: the follow-up question asks for a new step", async () => {
    const { result } = await run("TQ-DICE-FOLLOWUP", { rating: 5, feedback: "Genau: 32 Bit, also 0 bis 4294967295.", question: "Was passiert mit millis()-t, wenn millis() überläuft?" }, rule);
    expect(result.report.qualityVerdict.verdict).toBe("pass");
  });

  it("bad: a follow-up that asks for no new step is a finding of exactly that criterion", async () => {
    const { result } = await run("TQ-DICE-FOLLOWUP", { rating: 5, feedback: "Genau: 32 Bit, also 0 bis 4294967295.", question: "Kannst du deine Antwort noch einmal bestätigen?" }, rule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/new-thinking-step", effect: "warn" }]);
  });

  it("control: a near-duplicate of the answered question never reaches the Judge, because the application replaces it first", async () => {
    const { result, judgePrompts } = await run("TQ-DICE-FOLLOWUP", { rating: 5, feedback: "Genau: 32 Bit, also 0 bis 4294967295.", question: "Welchen Wertebereich kann eine Variable vom Typ `unsigned long` auf dem Arduino Uno also speichern?" }, rule);
    expect(judgePrompts[0]!.tutor.followUpQuestion).not.toContain("Wertebereich kann eine Variable vom Typ `unsigned long`");
    // The raw model fault stays visible as such, apart from the correct delivered question.
    expect(findings(result)).toEqual([{ class: "raw-provider-violation", key: "raw-provider/question-repeat", effect: "warn" }]);
  });
});

describe("graphic cases (focus graphic)", () => {
  const GOOD_PROCESS = "flowchart LR\n  A[pinMode OUTPUT] --> B[brightness 0 bis 255] --> C[brightness 255 bis 0]";
  const processRule: JudgeRule = ({ tutor }) => tutor.mermaid?.includes("Serial")
    ? { criterion: "graphic-matches-sketch", quote: "Serial.println" }
    : undefined;

  it("TQ-GRAPH-PROCESS good: the delivered graphic is evidence (tutor.mermaid) and the case passes", async () => {
    const { result, judgePrompts } = await run("TQ-GRAPH-PROCESS", { question: "In welcher Reihenfolge ändert sich brightness im Sketch?", mermaid: GOOD_PROCESS }, processRule);
    expect(judgePrompts[0]!.tutor.mermaid).toBe(GOOD_PROCESS);
    expect(result.semanticEvaluations[0]).toMatchObject({ focus: "graphic", turnKind: "initial", evaluation: { status: "evaluated" } });
    expect(result.report.qualityVerdict.verdict).toBe("pass");
  });

  it("TQ-GRAPH-PROCESS bad: a graphic with an edge the sketch does not have is a finding of exactly that criterion", async () => {
    const bad = "flowchart LR\n  A[setup] --> B[Serial.println]\n  B --> C[loop]";
    const { result } = await run("TQ-GRAPH-PROCESS", { question: "In welcher Reihenfolge ändert sich brightness im Sketch?", mermaid: bad }, processRule);
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/graphic-matches-sketch", effect: "warn" }]);
  });

  it("TQ-GRAPH-PROCESS: no graphic is not evaluated and makes no Judge call; the verdict is inconclusive, not a silent pass", async () => {
    const { result, judgePrompts } = await run("TQ-GRAPH-PROCESS", { question: "In welcher Reihenfolge ändert sich brightness im Sketch?" }, processRule);
    expect(judgePrompts).toHaveLength(0);
    expect(result.report.providerCalls.judgeCalls).toBe(0);
    expect(result.semanticEvaluations[0]).toMatchObject({ focus: "graphic", evaluation: { status: "not-evaluated", reason: "graphic-not-provided" } });
    expect(findings(result)).toEqual([{ class: "judge-not-evaluated", key: "judge/not-evaluated/graphic-not-provided", effect: "inconclusive" }]);
    expect(result.report.qualityVerdict.verdict).toBe("inconclusive");
  });

  // One question with one unambiguous answer (`run`, called directly in loop when the button condition holds), and
  // two graphics for this sketch and this question: the context graphic shows the condition and an unnamed action;
  // the revealing graphic names `run()` at exactly the asked place, without any "Lösung" wording. Both pass the
  // real Mermaid check and are delivered unchanged.
  const NO_SOLUTION_QUESTION = "Welche Funktion wird in loop bei erfüllter Tasterbedingung direkt aufgerufen?";
  const CONDITION = "flowchart TD\n  A[loop] --> B{state == WAITING und Taster LOW?}\n";
  const CONTEXT_GRAPHIC = `${CONDITION}  B -- ja --> C[Aktion ?]\n  B -- nein --> D[delay 250]\n  C --> D`;
  const REVEALING_GRAPHIC = `${CONDITION}  B -- ja --> C["run()"]\n  B -- nein --> D[delay 250]\n  C --> D`;
  // A test device for these two known graphics, not a general semantic check: it fails the criterion when the node
  // on the "ja" branch names the sought function.
  const answerOnYesBranch = /B -- ja --> C\["run\(\)"\]/;
  const solutionRule: JudgeRule = ({ tutor }) => tutor.mermaid !== undefined && answerOnYesBranch.test(tutor.mermaid)
    ? { criterion: "context-without-answer", quote: 'C["run()"]' }
    : undefined;

  it("the pair is valid: same sketch and question, the revealing graphic differs only in the asked node and has no Lösung wording", async () => {
    const scenario = await scenarioFor("TQ-GRAPH-NO-SOLUTION");
    // `run` is what loop calls when the button condition holds, in the sketch the case runs on
    const loopBody = scenario.sketch.slice(scenario.sketch.indexOf("void loop()"), scenario.sketch.indexOf("void run()"));
    expect(loopBody).toMatch(/if \(\(state==WAITING\)&&\(digitalRead\(BTN\)==LOW\)\)\s*\{\s*run\(\);/);
    expect(CONTEXT_GRAPHIC).not.toContain("run");
    expect(REVEALING_GRAPHIC).not.toMatch(/Lösung/i);
    expect(REVEALING_GRAPHIC.replace('C["run()"]', "C[Aktion ?]")).toBe(CONTEXT_GRAPHIC);
    // the earlier prefix rule would have let the revealing graphic through
    expect(REVEALING_GRAPHIC.includes("Lösung:")).toBe(false);
  });

  it("TQ-GRAPH-NO-SOLUTION good: the context graphic is delivered unchanged, judged as tutor.mermaid, and passes", async () => {
    const { result, judgePrompts } = await run("TQ-GRAPH-NO-SOLUTION", { question: NO_SOLUTION_QUESTION, mermaid: CONTEXT_GRAPHIC }, solutionRule);
    expect(result.transcripts[0]!.turns[0]!.finalTutorResult).toMatchObject({ question: NO_SOLUTION_QUESTION, mermaid: CONTEXT_GRAPHIC });
    expect(judgePrompts).toHaveLength(1);
    expect(judgePrompts[0]).toMatchObject({ turnKind: "initial", question: NO_SOLUTION_QUESTION, tutor: { mermaid: CONTEXT_GRAPHIC } });
    expect(result.semanticEvaluations[0]).toMatchObject({ scenarioId: "TQ-GRAPH-NO-SOLUTION", focus: "graphic", evaluation: { status: "evaluated" } });
    expect(findings(result)).toEqual([]);
    expect(result.report.qualityVerdict.verdict).toBe("pass");
  });

  it("TQ-GRAPH-NO-SOLUTION bad: a graphic that names run() at the asked place, without Lösung wording, is a finding of exactly that criterion", async () => {
    const { result, judgePrompts } = await run("TQ-GRAPH-NO-SOLUTION", { question: NO_SOLUTION_QUESTION, mermaid: REVEALING_GRAPHIC }, solutionRule);
    expect(result.transcripts[0]!.turns[0]!.finalTutorResult).toMatchObject({ question: NO_SOLUTION_QUESTION, mermaid: REVEALING_GRAPHIC });
    expect(judgePrompts[0]).toMatchObject({ question: NO_SOLUTION_QUESTION, tutor: { mermaid: REVEALING_GRAPHIC } });
    expect(findings(result)).toEqual([{ class: "judge-criterion", key: "criterion/context-without-answer", effect: "warn" }]);
    expect(result.semanticEvaluations[0]!.evaluation).toMatchObject({
      status: "evaluated",
      criteria: expect.arrayContaining([expect.objectContaining({ id: "context-without-answer", verdict: "fail", quote: 'C["run()"]' })]),
    });
  });
});

describe("severe single findings stay visible whatever the exit code", () => {
  it("one critical issue is a warn (repeat rule unchanged) with exit code 0, and is still listed in the summary and the report", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-severe-"));
    const lines: string[] = [];
    const provider = {
      async listModels() { return ["pilot-model", "judge-model"]; },
      async generateLearningQuestion() {
        return { model: "pilot-model", result: { responseStyle: "normal" as const, answerRating: 5 as const, feedback: "Richtig: show ruft Serial.println auf.", question: "Welche Funktion schreibt die Pins?" } };
      },
      async generateStructuredResponse(request: { readonly userPrompt: string }) {
        const input = JSON.parse(request.userPrompt.split("Evaluate this evidence object:\n")[1] ?? "{}") as { criteria: readonly { id: string }[] };
        return {
          model: "judge-model",
          result: {
            criteria: input.criteria.map(({ id }) => ({ id, verdict: "pass", reason: "Fine." })),
            criticalIssues: [{ code: "invented-sketch-property", reason: "show has no Serial call.", quote: "show ruft Serial.println auf" }],
          },
        };
      },
    };
    try {
      const exitCode = await runTutorQualityCliMain([
        "--model", "pilot-model", "--judge-model", "judge-model",
        "--credential-env", "TEST_TUTOR_CREDENTIAL", "--judge-credential-env", "TEST_JUDGE_CREDENTIAL",
        "--case", "TQ-DICE-SERIAL", "--samples", "1", "--max-calls", "20", "--output-dir", outputDir,
      ], {
        cwd: process.cwd(),
        environment: { TEST_TUTOR_CREDENTIAL: "tutor-secret", TEST_JUDGE_CREDENTIAL: "judge-secret" },
        provider,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true },
        log: (line) => lines.push(line),
      });
      expect(exitCode).toBe(0);
      const summary = JSON.parse(lines[0]!) as { qualityVerdict: string; severeFindings?: { scenarioId: string; class: string; key: string; effect: string }[] };
      expect(summary.qualityVerdict).toBe("warn");
      expect(summary.severeFindings).toMatchObject([{ scenarioId: "TQ-DICE-SERIAL", class: "critical-issue", key: "critical-issue/invented-sketch-property", effect: "warn" }]);
      const files = await Promise.all(["report.md"].map((name) => readFile(path.join(outputDir, name), "utf8").catch(() => "")));
      const markdown = files[0]!;
      expect(markdown).toContain("Severe findings");
      expect(markdown).toContain("critical-issue/invented-sketch-property");
      expect(markdown).toMatch(/no release of the model/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("a run without a severe finding adds neither a summary field nor a report section", async () => {
    const lines: string[] = [];
    const provider = { async listModels() { return ["pilot-model"]; }, async generateLearningQuestion() { return { model: "pilot-model", result: { responseStyle: "normal" as const, answerRating: 5 as const, feedback: "Richtig.", question: "Welche Funktion schreibt die Pins?" } }; } };
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "unosim-tq-nosevere-"));
    try {
      await runTutorQualityCliMain(["--model", "pilot-model", "--credential-env", "TEST_TUTOR_CREDENTIAL", "--case", "TQ-DICE-SERIAL", "--samples", "1", "--max-calls", "20", "--output-dir", outputDir], {
        cwd: process.cwd(), environment: { TEST_TUTOR_CREDENTIAL: "tutor-secret" }, provider,
        git: { sha: "a".repeat(40), trackedClean: true, relevantUntrackedClean: true }, log: (line) => lines.push(line),
      });
      expect(JSON.parse(lines[0]!)).not.toHaveProperty("severeFindings");
      expect(await readFile(path.join(outputDir, "report.md"), "utf8")).not.toContain("Severe findings");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

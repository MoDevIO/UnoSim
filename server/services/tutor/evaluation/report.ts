import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalDigest, sha256 } from "./canonical";
import { TUTOR_QUALITY_JUDGE_PROMPT_REVISION } from "./judge";
import { TUTOR_TEMPERATURE } from "../kiconnect-provider";
import { TUTOR_PROMPT_REVISION } from "../tutor-service";
import type { TutorQualityVerdict } from "./quality-verdict";
import type {
  TutorQualityDeterministicCheck,
  TutorQualityEvaluationOptions,
  TutorQualityEvaluationReport,
  TutorQualityInvariantViolation,
  TutorQualitySemanticEvaluationRecord,
  TutorQualityTranscript,
  TutorQualityTranscriptTurn,
} from "./real-provider-evaluation";

export interface TutorQualityRunManifest {
  readonly gitSha: string;
  /** Run-level corpus identity (§11.2); a run never mixes corpus versions. Absent only for an empty corpus. */
  readonly corpusId?: string;
  readonly corpusVersion?: number;
  readonly corpusFileDigests: readonly string[];
  readonly sketches: readonly { readonly scenarioId: string; readonly digest: string }[];
  readonly tutorPromptRevision: { readonly id: string; readonly textDigest: string };
  readonly tutorPrompts: readonly {
    readonly scenarioId: string;
    readonly sampleIndex: number;
    readonly turnIndex: number;
    readonly systemDigest: string;
    readonly userDigest: string;
  }[];
  readonly tutorModel: { readonly requested: string; readonly returned: readonly string[] };
  readonly judgeModel?: { readonly requested: string; readonly returned: readonly string[] };
  readonly temperature: { readonly tutor: number; readonly judge?: number };
  readonly timeoutMs?: number;
  readonly maxCalls: number;
  readonly judgePrompt?: {
    readonly revision: string;
    readonly prompts: readonly {
      readonly scenarioId: string;
      readonly sampleIndex: number;
      readonly digest: string;
      readonly systemDigest: string;
      readonly userDigest: string;
    }[];
  };
}

export function createTutorQualityRunManifest(
  options: TutorQualityEvaluationOptions,
  transcripts: readonly TutorQualityTranscript[],
  semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[],
): TutorQualityRunManifest {
  const tutorPrompts = transcripts.flatMap((transcript) => transcript.turns.flatMap((turn) => (
    turn.providerRequest ? [{
      scenarioId: transcript.scenario.id,
      sampleIndex: transcript.metadata.sampleIndex,
      turnIndex: turn.index,
      systemDigest: turn.providerRequest.systemPromptDigest,
      userDigest: turn.providerRequest.userPromptDigest,
    }] : []
  )));
  const judgePrompts = semanticEvaluations.flatMap(({ scenarioId, sampleIndex, evaluation }) => (
    evaluation.promptDigest && evaluation.systemPromptDigest && evaluation.userPromptDigest
      ? [{
        scenarioId,
        sampleIndex,
        digest: evaluation.promptDigest,
        systemDigest: evaluation.systemPromptDigest,
        userDigest: evaluation.userPromptDigest,
      }]
      : []
  ));
  const returnedJudgeModels = [...new Set(semanticEvaluations.flatMap(({ evaluation }) => evaluation.model ? [evaluation.model] : []))];
  const corpusFileDigests = [...new Set(options.scenarios.flatMap(({ corpusFileDigest }) => corpusFileDigest ? [corpusFileDigest] : []))];
  const corpus = options.scenarios[0];
  return {
    gitSha: options.git.sha,
    ...(corpus ? { corpusId: corpus.corpusId, corpusVersion: corpus.corpusVersion } : {}),
    corpusFileDigests,
    sketches: options.scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      digest: scenario.sketchDigest ?? sha256(scenario.sketch),
    })),
    tutorPromptRevision: {
      id: transcripts[0]?.metadata.promptRevision.id ?? TUTOR_PROMPT_REVISION.id,
      textDigest: transcripts[0]?.metadata.promptRevision.templateDigest ?? TUTOR_PROMPT_REVISION.templateDigest ?? canonicalDigest({}),
    },
    tutorPrompts,
    tutorModel: {
      requested: options.requestedModel,
      returned: [...new Set(transcripts.flatMap(({ metadata }) => metadata.returnedModels))],
    },
    ...(options.judgeModel ? { judgeModel: { requested: options.judgeModel, returned: returnedJudgeModels } } : {}),
    temperature: { tutor: TUTOR_TEMPERATURE, ...(options.judgeModel ? { judge: 0 } : {}) },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    maxCalls: options.maxCalls,
    ...(options.judgeModel ? {
      judgePrompt: {
        revision: TUTOR_QUALITY_JUDGE_PROMPT_REVISION,
        prompts: judgePrompts,
      },
    } : {}),
  };
}

type CheckOutcome = "pass" | "fail" | "not-applicable";

interface CheckDiagnostics {
  readonly name: string;
  readonly outcome: CheckOutcome;
  readonly passed: boolean;
  readonly details?: string;
  readonly reason?: string;
}

interface TurnDiagnostics {
  readonly index: number;
  readonly learningPhase?: string;
  readonly answerRating?: number;
  readonly progressionBlockedReason?: string;
  readonly followUpSource?: string;
  readonly durationMs: number;
  readonly providerCalls: TutorQualityTranscriptTurn["providerCalls"];
  readonly checks: readonly CheckDiagnostics[];
  readonly violations: readonly TutorQualityInvariantViolation[];
}

// Locale-independent, so that two runs on different machines order identically (R-REP-3).
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function checkDiagnostics(check: TutorQualityDeterministicCheck): CheckDiagnostics {
  const outcome: CheckOutcome = check.outcome ?? (check.passed ? "pass" : "fail");
  return {
    name: check.name,
    outcome,
    passed: check.passed,
    ...(check.details ? { details: check.details } : {}),
    ...(check.reason ? { reason: check.reason } : {}),
  };
}

function sortedViolations(violations: readonly TutorQualityInvariantViolation[]): TutorQualityInvariantViolation[] {
  return [...violations].sort((left, right) => (
    (left.turnIndex ?? -1) - (right.turnIndex ?? -1)
    || compareText(left.source, right.source)
    || compareText(left.code, right.code)
  ));
}

function turnDiagnostics(
  turn: TutorQualityTranscriptTurn,
  isLast: boolean,
  transcript: TutorQualityTranscript,
): TurnDiagnostics {
  const result = turn.finalTutorResult;
  const blocked = result?.progressionBlockedReason ?? (isLast ? transcript.stateAfter?.progressionBlockedReason : undefined);
  return {
    index: turn.index,
    ...(typeof result?.learningPhase === "string" ? { learningPhase: result.learningPhase } : {}),
    ...(typeof result?.answerRating === "number" ? { answerRating: result.answerRating } : {}),
    ...(typeof blocked === "string" ? { progressionBlockedReason: blocked } : {}),
    // R-FUP-4: never guess; a final result without a recorded source is reported as unavailable.
    ...(result ? { followUpSource: turn.followUpSource ?? "unavailable" } : {}),
    durationMs: turn.durationMs,
    providerCalls: turn.providerCalls,
    checks: turn.deterministicChecks.map(checkDiagnostics).sort((left, right) => compareText(left.name, right.name)),
    violations: sortedViolations(transcript.invariantViolations.filter(({ turnIndex }) => turnIndex === turn.index)),
  };
}

function sortedTranscripts(transcripts: readonly TutorQualityTranscript[]): TutorQualityTranscript[] {
  return [...transcripts].sort((left, right) => (
    compareText(left.scenario.id, right.scenario.id) || left.metadata.sampleIndex - right.metadata.sampleIndex
  ));
}

function sortedSemanticEvaluations(
  evaluations: readonly TutorQualitySemanticEvaluationRecord[],
): TutorQualitySemanticEvaluationRecord[] {
  return [...evaluations].sort((left, right) => (
    compareText(left.scenarioId, right.scenarioId) || left.sampleIndex - right.sampleIndex
  ));
}

function createCriterionTotals(semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[]) {
  const criterionTotals = new Map<string, { readonly scenarioId: string; readonly criterionId: string; pass: number; fail: number; unclear: number }>();
  for (const { scenarioId, evaluation } of semanticEvaluations) {
    for (const criterion of evaluation.criteria ?? []) {
      const key = `${scenarioId}\0${criterion.id}`;
      const current = criterionTotals.get(key) ?? { scenarioId, criterionId: criterion.id, pass: 0, fail: 0, unclear: 0 };
      current[criterion.verdict] += 1;
      criterionTotals.set(key, current);
    }
  }
  return [...criterionTotals.values()].sort((left, right) => (
    compareText(left.scenarioId, right.scenarioId) || compareText(left.criterionId, right.criterionId)
  ));
}

function createPhaseSummaries(semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[]): string[] {
  return ["LEARN", "DEEPEN", "EXPAND"].map((phase) => {
    const matching = semanticEvaluations.filter(({ learningPhase }) => learningPhase === phase);
    const evaluated = matching.filter(({ evaluation }) => evaluation.status === "evaluated").length;
    const failed = matching.flatMap(({ evaluation }) => evaluation.criteria ?? []).filter(({ verdict }) => verdict === "fail").length;
    return `- ${phase}: ${matching.length} cases, ${evaluated} evaluated, ${failed} failing criteria`;
  });
}

function formatEvaluationStatus(evaluation: NonNullable<TutorQualityEvaluationReport["semanticEvaluations"]>[number]["evaluation"]): string {
  return "Status: " + evaluation.status + (evaluation.reason ? " — " + evaluation.reason : "");
}

function formatCriterion(criterion: NonNullable<TutorQualityEvaluationReport["semanticEvaluations"]>[number]["evaluation"]["criteria"] extends readonly (infer Criterion)[] | undefined ? Criterion : never): string {
  const quote = criterion.quote ? " — “" + criterion.quote + "”" : "";
  const reason = criterion.reason ? " (" + criterion.reason + ")" : "";
  return "- " + criterion.id + ": " + criterion.verdict + quote + reason;
}

function formatCriticalIssue(issue: NonNullable<TutorQualityEvaluationReport["semanticEvaluations"]>[number]["evaluation"]["criticalIssues"] extends readonly (infer Issue)[] | undefined ? Issue : never): string {
  return "- Critical " + issue.code + ": “" + issue.quote + "” (" + issue.reason + ")";
}

function createSampleDetails(semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[]): string[] {
  const lines: string[] = [];
  for (const { scenarioId, sampleIndex, evaluation } of semanticEvaluations) {
    lines.push("### " + scenarioId + " / sample " + sampleIndex, "", formatEvaluationStatus(evaluation), "");
    for (const criterion of evaluation.criteria ?? []) lines.push(formatCriterion(criterion));
    for (const issue of evaluation.criticalIssues ?? []) lines.push(formatCriticalIssue(issue));
    lines.push("");
  }
  return lines;
}

function formatCheckLine(check: CheckDiagnostics): string {
  if (check.outcome === "not-applicable") return "  - [n/a] " + check.name + (check.reason ? " (" + check.reason + ")" : "");
  return "  - [" + check.outcome + "] " + check.name + (check.details ? " (" + check.details + ")" : "");
}

function formatTurnLines(turn: TurnDiagnostics): string[] {
  const rating = turn.answerRating === undefined ? "none" : String(turn.answerRating);
  return [
    "- turn " + turn.index + ": phase " + (turn.learningPhase ?? "none") + ", rating " + rating
      + ", blocked " + (turn.progressionBlockedReason ?? "none") + ", follow-up " + (turn.followUpSource ?? "none"),
    // Timings vary from run to run; their own lines keep the diagnostic lines comparable by text diff.
    "  - duration: " + turn.durationMs + " ms",
    ...turn.checks.map(formatCheckLine),
    ...turn.violations.map((violation) => "  - violation " + violation.source + " / " + violation.code
      + (violation.details ? " (" + violation.details + ")" : "")),
  ];
}

function createDeterministicDiagnostics(
  transcripts: readonly TutorQualityTranscript[],
  semanticEvaluations: readonly TutorQualitySemanticEvaluationRecord[],
): string[] {
  const lines: string[] = [];
  for (const transcript of sortedTranscripts(transcripts)) {
    const semantic = semanticEvaluations.find(({ scenarioId, sampleIndex }) => (
      scenarioId === transcript.scenario.id && sampleIndex === transcript.metadata.sampleIndex
    ));
    const calls = transcript.metadata.providerCalls;
    lines.push(
      "#### " + transcript.scenario.id + " / sample " + transcript.metadata.sampleIndex,
      "",
      "- status: " + transcript.executionStatus + (transcript.invalidReason ? " (" + transcript.invalidReason + ")" : "")
        + "; phase after: " + (transcript.stateAfter?.phase ?? "none")
        + "; calls: list " + calls.modelListCalls + ", tutor " + calls.generationCalls,
      "- duration: " + transcript.metadata.sampleDurationMs + " ms",
      "- judge: " + (semantic?.evaluation.status ?? "not requested"),
      ...(transcript.technicalError ? ["- technical error: " + transcript.technicalError.kind] : []),
      ...transcript.turns.flatMap((turn, index) => formatTurnLines(turnDiagnostics(turn, index === transcript.turns.length - 1, transcript))),
      ...transcript.invariantViolations.filter(({ turnIndex }) => turnIndex === undefined).map((violation) => "- violation " + violation.source + " / " + violation.code),
      "",
    );
  }
  return lines;
}

function formatFinding(finding: TutorQualityVerdict["findings"][number]): string {
  const samples = finding.samples.length ? " (samples " + finding.samples.join(", ") + ")" : "";
  return "- [" + finding.effect + "] " + (finding.scenarioId ?? "run") + ": " + finding.class + " " + finding.key + samples;
}

function createVerdictLines(verdict: TutorQualityVerdict): string[] {
  return [
    "## Quality verdict",
    "",
    "Verdict: " + verdict.verdict,
    "Rule: " + verdict.ruleRevision + "; samples per case " + verdict.samplesPerCase + "; repeat threshold " + verdict.repeatThreshold
      + "; Judge " + (verdict.judgeConfigured ? "configured" : "not configured"),
    ...(verdict.findings.length ? verdict.findings.map(formatFinding) : ["- no findings"]),
    "",
  ];
}

function markdown(
  report: TutorQualityEvaluationReport,
  manifest: TutorQualityRunManifest,
  transcripts: readonly TutorQualityTranscript[],
): string {
  const semanticEvaluations = sortedSemanticEvaluations(report.semanticEvaluations ?? []);
  const criterionTotals = createCriterionTotals(semanticEvaluations);
  const phaseSummaries = createPhaseSummaries(semanticEvaluations);
  const lines = [
    "# Tutor Quality evaluation",
    "",
    "Run: " + report.runId,
    "Status: " + report.runStatus + (report.reason ? " (" + report.reason + ")" : ""),
    "Git: " + manifest.gitSha,
    "Tutor model: " + manifest.tutorModel.requested + " → " + (manifest.tutorModel.returned.join(", ") || "none"),
    ...(manifest.judgeModel ? ["Judge model: " + manifest.judgeModel.requested + " → " + (manifest.judgeModel.returned.join(", ") || "none")] : []),
    "Temperature: Tutor " + manifest.temperature.tutor + (manifest.temperature.judge === undefined ? "" : ", Judge " + manifest.temperature.judge),
    "Timeout: " + (manifest.timeoutMs ?? "provider default") + " ms",
    "Call budget: " + manifest.maxCalls,
    "Provider calls: " + report.providerCalls.total + " (list " + report.providerCalls.modelListCalls + ", tutor " + report.providerCalls.generationCalls + ", judge " + report.providerCalls.judgeCalls + ")",
    "Duration: " + report.totalDurationMs + " ms",
    "Corpus: " + (manifest.corpusId === undefined ? "unavailable" : manifest.corpusId + " v" + manifest.corpusVersion),
    "Corpus file digests: " + (manifest.corpusFileDigests.join(", ") || "unavailable"),
    "",
    ...createVerdictLines(report.qualityVerdict),
    "## Deterministic diagnostics",
    "",
    ...createDeterministicDiagnostics(transcripts, semanticEvaluations),
    "## Semantic evaluations",
    "",
    "### Phase summary",
    ...phaseSummaries,
    "",
    "### Criteria summary",
    "",
    "| Scenario | Criterion | pass | fail | unclear |",
    "| --- | --- | ---: | ---: | ---: |",
    ...criterionTotals.map(({ scenarioId, criterionId, pass, fail, unclear }) => "| " + scenarioId + " | " + criterionId + " | " + pass + " | " + fail + " | " + unclear + " |"),
    "",
    "### Sample details",
    "",
  ];
  lines.push(...createSampleDetails(semanticEvaluations));
  return `${lines.join("\n")}\n`;
}

export async function writeRunArtifacts(
  outputDir: string | undefined,
  report: TutorQualityEvaluationReport,
  manifest: TutorQualityRunManifest,
  transcripts: readonly TutorQualityTranscript[],
): Promise<void> {
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  const samples = sortedTranscripts(transcripts).map((transcript) => {
    const semantic = report.semanticEvaluations?.find(({ scenarioId, sampleIndex }) => (
      scenarioId === transcript.scenario.id && sampleIndex === transcript.metadata.sampleIndex
    ));
    const judgeCalls = semantic?.evaluation.durationMs === undefined ? 0 : 1;
    const stageACalls = transcript.metadata.providerCalls;
    return {
      scenarioId: transcript.scenario.id,
      sampleIndex: transcript.metadata.sampleIndex,
      stageAStatus: transcript.executionStatus,
      ...(transcript.invalidReason ? { invalidReason: transcript.invalidReason } : {}),
      ...(transcript.technicalError ? { technicalError: transcript.technicalError } : {}),
      ...(transcript.stateAfter?.phase ? { phaseAfter: transcript.stateAfter.phase } : {}),
      durationMs: transcript.metadata.sampleDurationMs,
      deterministicChecks: transcript.deterministicChecks,
      turns: transcript.turns.map((turn, index) => turnDiagnostics(turn, index === transcript.turns.length - 1, transcript)),
      violations: sortedViolations(transcript.invariantViolations),
      ...(semantic ? { semanticEvaluation: semantic.evaluation } : {}),
      providerCalls: {
        ...stageACalls,
        total: stageACalls.total + judgeCalls,
        judgeCalls,
      },
    };
  });
  await writeFile(`${outputDir}/report.json`, `${JSON.stringify({ ...report, manifest, samples }, null, 2)}\n`, "utf8");
  await writeFile(`${outputDir}/report.md`, markdown(report, manifest, transcripts), "utf8");
  const transcriptDirectory = path.join(outputDir, "transcripts");
  if (transcripts.length) await mkdir(transcriptDirectory, { recursive: true });
  await Promise.all(transcripts.map((transcript) => {
    const safeId = transcript.scenario.id.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    const index = transcript.metadata.sampleIndex;
    return writeFile(path.join(transcriptDirectory, `transcript-${safeId}-${index}.json`), `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  }));
}

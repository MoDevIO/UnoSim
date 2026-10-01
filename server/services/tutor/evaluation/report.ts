import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalDigest, sha256 } from "./canonical";
import { TUTOR_QUALITY_JUDGE_PROMPT_REVISION } from "./judge";
import { TUTOR_TEMPERATURE } from "../kiconnect-provider";
import { TUTOR_PROMPT_REVISION } from "../tutor-service";
import type {
  TutorQualityEvaluationOptions,
  TutorQualityEvaluationReport,
  TutorQualitySemanticEvaluationRecord,
  TutorQualityTranscript,
} from "./real-provider-evaluation";

export interface TutorQualityRunManifest {
  readonly gitSha: string;
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
  return {
    gitSha: options.git.sha,
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
  return [...criterionTotals.values()];
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

function markdown(report: TutorQualityEvaluationReport, manifest: TutorQualityRunManifest): string {
  const semanticEvaluations = report.semanticEvaluations ?? [];
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
    "Corpus file digests: " + (manifest.corpusFileDigests.join(", ") || "unavailable"),
    "",
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
  const samples = transcripts.map((transcript) => {
    const semantic = report.semanticEvaluations?.find(({ scenarioId, sampleIndex }) => (
      scenarioId === transcript.scenario.id && sampleIndex === transcript.metadata.sampleIndex
    ));
    const judgeCalls = semantic?.evaluation.durationMs === undefined ? 0 : 1;
    const stageACalls = transcript.metadata.providerCalls;
    return {
      scenarioId: transcript.scenario.id,
      sampleIndex: transcript.metadata.sampleIndex,
      stageAStatus: transcript.executionStatus,
      deterministicChecks: transcript.deterministicChecks,
      ...(semantic ? { semanticEvaluation: semantic.evaluation } : {}),
      providerCalls: {
        ...stageACalls,
        total: stageACalls.total + judgeCalls,
        judgeCalls,
      },
    };
  });
  await writeFile(`${outputDir}/report.json`, `${JSON.stringify({ ...report, manifest, samples }, null, 2)}\n`, "utf8");
  await writeFile(`${outputDir}/report.md`, markdown(report, manifest), "utf8");
  const transcriptDirectory = path.join(outputDir, "transcripts");
  if (transcripts.length) await mkdir(transcriptDirectory, { recursive: true });
  await Promise.all(transcripts.map((transcript) => {
    const safeId = transcript.scenario.id.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    const index = transcript.metadata.sampleIndex;
    return writeFile(path.join(transcriptDirectory, `transcript-${safeId}-${index}.json`), `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  }));
}

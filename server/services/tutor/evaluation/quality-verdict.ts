import type { TutorQualitySemanticEvaluation } from "./judge";

/** Normative rule: Evaluation SSOT §12 (R-VER-1..9). Bump on every rule change (R-VER-9). */
export const TUTOR_QUALITY_VERDICT_RULE_REVISION = "tutor-quality-verdict-v1";

export type TutorQualityVerdictValue = "pass" | "warn" | "fail" | "inconclusive";
type FindingEffect = Exclude<TutorQualityVerdictValue, "pass">;

// Declaration order is the SSOT §12 table order and the report sort order.
const FINDING_CLASSES = [
  "run-not-completed",
  "product-violation",
  "rating-out-of-band",
  "raw-provider-violation",
  "judge-criterion",
  "critical-issue",
  "unclear-criterion",
  "scenario-violation",
  "sample-not-completed",
  "judge-not-evaluated",
] as const;

export type TutorQualityFindingClass = typeof FINDING_CLASSES[number];

export interface TutorQualityVerdictFinding {
  /** Absent only for a run-level finding. */
  readonly scenarioId?: string;
  readonly class: TutorQualityFindingClass;
  readonly key: string;
  /** Sorted sample indexes of the case that carry the finding; each sample at most once (R-VER-3). */
  readonly samples: readonly number[];
  readonly effect: FindingEffect;
}

export interface TutorQualityVerdict {
  readonly verdict: TutorQualityVerdictValue;
  readonly ruleRevision: typeof TUTOR_QUALITY_VERDICT_RULE_REVISION;
  readonly samplesPerCase: number;
  readonly repeatThreshold: number;
  readonly judgeConfigured: boolean;
  readonly findings: readonly TutorQualityVerdictFinding[];
}

export interface TutorQualityVerdictSample {
  readonly scenarioId: string;
  readonly sampleIndex: number;
  readonly executionStatus: "completed" | "invalid" | "technical-failure" | "not-run";
  readonly invalidReason?: string;
  readonly technicalErrorKind?: string;
  readonly violations: readonly {
    readonly source: "raw-provider" | "final-tutor" | "state" | "scenario";
    readonly code: string;
    readonly turnIndex?: number;
  }[];
}

export interface TutorQualityVerdictSemanticRecord {
  readonly scenarioId: string;
  readonly sampleIndex: number;
  readonly evaluation: Pick<TutorQualitySemanticEvaluation, "status" | "reason" | "criteria" | "criticalIssues">;
}

export interface TutorQualityVerdictInput {
  readonly runStatus: TutorQualityVerdictSample["executionStatus"];
  readonly runReason?: string;
  readonly samplesPerCase: number;
  readonly judgeConfigured: boolean;
  readonly samples: readonly TutorQualityVerdictSample[];
  readonly semanticEvaluations: readonly TutorQualityVerdictSemanticRecord[];
}

const EFFECT_PRIORITY: readonly FindingEffect[] = ["fail", "inconclusive", "warn"];
const RATING_VIOLATION_CODE = "answer-rating-out-of-band";

/** k(n) = max(2, ⌊n/2⌋ + 1): a strict majority of the case's samples, never a single sample (R-VER-4). */
export function repeatThreshold(samplesPerCase: number): number {
  return Math.max(2, Math.floor(samplesPerCase / 2) + 1);
}

interface Occurrence {
  readonly scenarioId?: string;
  readonly class: TutorQualityFindingClass;
  readonly key: string;
  readonly sampleIndex?: number;
}

function violationClass(source: TutorQualityVerdictSample["violations"][number]["source"], code: string): TutorQualityFindingClass {
  if (source === "raw-provider") return "raw-provider-violation";
  if (source === "scenario") return "scenario-violation";
  if (source === "final-tutor" && code === RATING_VIOLATION_CODE) return "rating-out-of-band";
  return "product-violation";
}

function sampleOccurrences(sample: TutorQualityVerdictSample): Occurrence[] {
  const { scenarioId, sampleIndex } = sample;
  const occurrences: Occurrence[] = sample.violations.map(({ source, code }) => ({
    scenarioId,
    sampleIndex,
    class: violationClass(source, code),
    key: `${source}/${code}`,
  }));
  if (sample.executionStatus !== "completed") {
    const reason = sample.invalidReason ?? sample.technicalErrorKind ?? "unknown";
    occurrences.push({ scenarioId, sampleIndex, class: "sample-not-completed", key: `execution/${sample.executionStatus}/${reason}` });
  }
  return occurrences;
}

function semanticOccurrences({ scenarioId, sampleIndex, evaluation }: TutorQualityVerdictSemanticRecord): Occurrence[] {
  if (evaluation.status !== "evaluated") {
    return [{ scenarioId, sampleIndex, class: "judge-not-evaluated", key: `judge/${evaluation.status}/${evaluation.reason ?? "unknown"}` }];
  }
  return [
    ...(evaluation.criteria ?? []).flatMap(({ id, verdict }): Occurrence[] => {
      if (verdict === "fail") return [{ scenarioId, sampleIndex, class: "judge-criterion", key: `criterion/${id}` }];
      if (verdict === "unclear") return [{ scenarioId, sampleIndex, class: "unclear-criterion", key: `criterion-unclear/${id}` }];
      return [];
    }),
    ...(evaluation.criticalIssues ?? []).map(({ code }): Occurrence => ({ scenarioId, sampleIndex, class: "critical-issue", key: `critical-issue/${code}` })),
  ];
}

function effectFor(findingClass: TutorQualityFindingClass, sampleCount: number, threshold: number): FindingEffect {
  const repeated = sampleCount >= threshold;
  switch (findingClass) {
    case "product-violation":
      return "fail";
    case "rating-out-of-band":
    case "raw-provider-violation":
    case "judge-criterion":
    case "critical-issue":
      return repeated ? "fail" : "warn";
    case "unclear-criterion":
      return repeated ? "inconclusive" : "warn";
    case "run-not-completed":
    case "scenario-violation":
    case "sample-not-completed":
    case "judge-not-evaluated":
      return "inconclusive";
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function compareFindings(left: TutorQualityVerdictFinding, right: TutorQualityVerdictFinding): number {
  return compareText(left.scenarioId ?? "", right.scenarioId ?? "")
    || FINDING_CLASSES.indexOf(left.class) - FINDING_CLASSES.indexOf(right.class)
    || compareText(left.key, right.key);
}

/** The single aggregation of Evaluation SSOT §12; no other code derives a quality verdict. */
export function computeTutorQualityVerdict(input: TutorQualityVerdictInput): TutorQualityVerdict {
  const threshold = repeatThreshold(input.samplesPerCase);
  const occurrences: Occurrence[] = [
    ...(input.runStatus === "completed"
      ? []
      : [{ class: "run-not-completed" as const, key: `run/${input.runStatus}/${input.runReason ?? "unknown"}` }]),
    ...input.samples.flatMap(sampleOccurrences),
    ...input.semanticEvaluations.flatMap(semanticOccurrences),
  ];
  // Group per (case, class, key); a sample counts at most once per group (R-VER-3).
  const groups = new Map<string, { readonly scenarioId?: string; readonly class: TutorQualityFindingClass; readonly key: string; readonly samples: Set<number> }>();
  for (const occurrence of occurrences) {
    const groupKey = [occurrence.scenarioId ?? "", occurrence.class, occurrence.key].join("\0");
    const group = groups.get(groupKey) ?? {
      ...(occurrence.scenarioId === undefined ? {} : { scenarioId: occurrence.scenarioId }),
      class: occurrence.class,
      key: occurrence.key,
      samples: new Set<number>(),
    };
    if (occurrence.sampleIndex !== undefined) group.samples.add(occurrence.sampleIndex);
    groups.set(groupKey, group);
  }
  const findings = [...groups.values()].map((group): TutorQualityVerdictFinding => {
    const samples = [...group.samples].sort((left, right) => left - right);
    return {
      ...(group.scenarioId === undefined ? {} : { scenarioId: group.scenarioId }),
      class: group.class,
      key: group.key,
      samples,
      effect: effectFor(group.class, samples.length, threshold),
    };
  }).sort(compareFindings);
  const verdict = EFFECT_PRIORITY.find((effect) => findings.some((finding) => finding.effect === effect)) ?? "pass";
  return {
    verdict,
    ruleRevision: TUTOR_QUALITY_VERDICT_RULE_REVISION,
    samplesPerCase: input.samplesPerCase,
    repeatThreshold: threshold,
    judgeConfigured: input.judgeConfigured,
    findings,
  };
}

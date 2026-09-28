import type { TutorQualityEvaluationScenario } from "../real-provider-evaluation";
import type { TutorPlanningContentContext } from "../../tutor-planning";
import { canonicalSemanticDigest, canonicalSemanticJson, semanticSha256 } from "./semantic-canonical";
import { validateFrozenPreTurnContext } from "./frozen-context";
import { semanticCaseDigest, semanticCorpusDigest, type SemanticCase, type SemanticCorpus } from "./semantic-corpus";

export interface SemanticFixtureResolver {
  readonly sketches: ReadonlyMap<string, string>;
  readonly courseContent: ReadonlyMap<string, TutorPlanningContentContext>;
}

export interface AdapterGeneratedProvenance {
  readonly kind: "adapter-generated";
  readonly semanticCorpusId: string;
  readonly semanticCorpusVersion: number;
  readonly semanticCaseId: string;
  readonly semanticCaseDigest: string;
  readonly frozenPreTurnContextDigest: string;
  readonly scenarioId: string;
  readonly stageAScenario: TutorQualityEvaluationScenario;
  readonly stageAScenarioDigest: string;
  readonly identity: string;
}

export interface AdapterGeneratedScenario {
  readonly scenario: TutorQualityEvaluationScenario;
  readonly provenance: AdapterGeneratedProvenance;
}

export interface ScenarioCompatibility {
  readonly compatible: boolean;
  readonly reason?: string;
}

function makeExpectedTurn(semanticCase: SemanticCase): TutorQualityEvaluationScenario["turns"][number] {
  const context = semanticCase.frozenPreTurnContext;
  return {
    kind: "dialog",
    question: context.question,
    answer: context.learnerAnswer.text,
    bindsToQuestion: context.learnerAnswer.bindsToQuestion,
    difficulty: context.difficulty,
    history: context.priorDialog,
  };
}

function stageAEffectiveTurn(turn: TutorQualityEvaluationScenario["turns"][number]): TutorQualityEvaluationScenario["turns"][number] {
  // Stage 2A's historyFromSource() treats an omitted history as an empty list.
  // Normalize only that runtime default; preserve every declared history entry and its order.
  return turn.kind === "dialog" && turn.history === undefined ? { ...turn, history: [] } : turn;
}

export function assessStageAScenarioCompatibility(
  scenario: TutorQualityEvaluationScenario,
  semanticCase: SemanticCase,
): ScenarioCompatibility {
  const context = semanticCase.frozenPreTurnContext;
  if (context.sketchRef !== semanticCase.sketch.reference || context.sketchDigest !== semanticCase.sketch.digest) {
    return { compatible: false, reason: "frozen-context-sketch-reference-or-digest-mismatch" };
  }
  if (scenario.sketchRef !== semanticCase.sketch.reference || semanticSha256(scenario.sketch) !== semanticCase.sketch.digest) {
    return { compatible: false, reason: "sketch-reference-or-digest-mismatch" };
  }
  if (scenario.turns.length !== 1 || canonicalSemanticJson(stageAEffectiveTurn(scenario.turns[0])) !== canonicalSemanticJson(makeExpectedTurn(semanticCase))) {
    return { compatible: false, reason: "preceding-question-answer-history-or-difficulty-mismatch" };
  }
  if (context.courseContent.kind === "free-tutor") {
    if (scenario.courseContent !== undefined) return { compatible: false, reason: "course-content-present-for-free-tutor-case" };
  } else {
    if (scenario.courseContent?.revision !== context.courseContent.revision) {
      return { compatible: false, reason: "course-content-revision-mismatch" };
    }
    if (canonicalSemanticDigest(scenario.courseContent) !== context.courseContent.digest) {
      return { compatible: false, reason: "course-content-or-strategy-digest-mismatch" };
    }
  }
  return { compatible: true };
}

function provenanceIdentity(source: Omit<AdapterGeneratedProvenance, "identity">): string {
  return canonicalSemanticDigest(source);
}

export function toStage2AScenario(
  corpus: SemanticCorpus,
  semanticCase: SemanticCase,
  fixtures: SemanticFixtureResolver,
): AdapterGeneratedScenario {
  if (semanticCorpusDigest(corpus) !== corpus.digest) throw new Error("Semantic Corpus digest does not match its canonical content");
  const contextValidation = validateFrozenPreTurnContext(semanticCase.frozenPreTurnContext);
  if (!contextValidation.valid) throw new Error(`Invalid Frozen Pre-Turn Context: ${contextValidation.reason}`);
  const corpusCase = corpus.cases.find(({ id }) => id === semanticCase.id);
  if (semanticCase.corpusId !== corpus.corpusId || semanticCase.corpusVersion !== corpus.corpusVersion
    || !corpusCase || semanticCaseDigest(corpusCase) !== semanticCaseDigest(semanticCase)) {
    throw new Error("Semantic Case is not the immutable case content selected by this Semantic Corpus");
  }
  const sketch = fixtures.sketches.get(semanticCase.sketch.reference);
  if (sketch === undefined || semanticSha256(sketch) !== semanticCase.sketch.digest) {
    throw new Error("Stage-2A adapter cannot resolve the exact pinned sketch fixture");
  }

  let courseContent: TutorPlanningContentContext | undefined;
  if (contextValidation.context.courseContent.kind === "repository-course-content") {
    const reference = contextValidation.context.courseContent;
    courseContent = fixtures.courseContent.get(reference.reference);
    if (courseContent?.revision !== reference.revision || canonicalSemanticDigest(courseContent) !== reference.digest) {
      throw new Error("Stage-2A adapter cannot resolve the exact Course Content and Strategy context");
    }
  }

  const scenario: TutorQualityEvaluationScenario = {
    id: semanticCase.id,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    sketchRef: semanticCase.sketch.reference,
    sketch,
    ...(courseContent ? { courseContent } : {}),
    turns: [makeExpectedTurn(semanticCase)],
  };
  const provenanceWithoutIdentity: Omit<AdapterGeneratedProvenance, "identity"> = {
    kind: "adapter-generated",
    semanticCorpusId: corpus.corpusId,
    semanticCorpusVersion: corpus.corpusVersion,
    semanticCaseId: semanticCase.id,
    semanticCaseDigest: semanticCase.digest,
    frozenPreTurnContextDigest: contextValidation.context.digest,
    scenarioId: scenario.id,
    stageAScenario: scenario,
    stageAScenarioDigest: canonicalSemanticDigest(scenario),
  };
  const provenance: AdapterGeneratedProvenance = {
    ...provenanceWithoutIdentity,
    identity: provenanceIdentity(provenanceWithoutIdentity),
  };
  return { scenario, provenance };
}

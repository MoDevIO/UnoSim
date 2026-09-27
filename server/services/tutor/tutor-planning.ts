import type { TutorAnswerRating, TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import type { TutorCapability } from "../course-content/course-content-loader";
import type { ExampleTutorAnnotation } from "../course-content/embedded-tutor-annotation";
import type { StrategyResolution } from "./strategy/effective-tutor-strategy";
import type { TutorProgressionState, DidacticPhase, ProgressionBlockedReason } from "./curriculum/progression-state";

export interface TutorPlanningContentContext {
  readonly revision: string;
  readonly tutor?: TutorCapability;
  readonly exampleId?: string;
  readonly exampleTutorAnnotation?: ExampleTutorAnnotation;
  readonly progressionState?: TutorProgressionState;
}

/** Normalized, implementation-independent plan data consumed by TutorService. */
export interface TutorPlan {
  readonly topicId: string;
  readonly topicTitle: string;
  readonly conceptId: string;
  readonly conceptTitle: string;
  readonly objective: string;
  readonly questionId: string;
  readonly questionKind: "recall" | "concept" | "application" | "prediction" | "transfer";
  readonly indicatorId: string;
  readonly indicator: string;
  readonly question: string;
  readonly misconceptions: readonly { id: string; description: string }[];
  readonly strategyId?: string;
  readonly strategySource?: "built-in" | "repository";
  readonly scaffold?: { readonly id: string; readonly strategy: string; readonly hint: string };
  readonly contentRevision: string;
  readonly learningPhase?: DidacticPhase;
  readonly activeTopicId?: string;
  readonly masteredTopicIds?: readonly string[];
  readonly progressionBlockedReason?: ProgressionBlockedReason;
  readonly extensionTargetTopicId?: string;
  readonly expansionBrief?: TutorExpansionBrief;
}

/** Application-owned, normalized guidance for one EXPAND transition. */
export interface TutorExpansionBrief {
  readonly sourceTopicId: string;
  readonly targetTopicId: string;
  readonly objective: string;
}

export interface TutorPlanningBlocked {
  readonly kind: "blocked";
  readonly progressionBlockedReason: ProgressionBlockedReason;
  readonly contentRevision: string;
  readonly learningPhase: DidacticPhase;
  readonly activeTopicId?: string;
  readonly masteredTopicIds: readonly string[];
  readonly strategyId: string;
  readonly strategySource: "built-in" | "repository";
}

export interface TutorPlanningTransition {
  readonly kind: "transition";
  readonly contentRevision: string;
  readonly learningPhase: DidacticPhase;
  readonly activeTopicId?: string;
  readonly masteredTopicIds: readonly string[];
  readonly strategyId: string;
  readonly strategySource: "built-in" | "repository";
}

export type TutorPlanningResult = TutorPlan | TutorPlanningBlocked | TutorPlanningTransition;

export function isTutorPlan(result: TutorPlanningResult | null): result is TutorPlan {
  return result !== null && !("kind" in result);
}

export function isTutorPlanningBlocked(result: TutorPlanningResult | null): result is TutorPlanningBlocked {
  return result !== null && "kind" in result && result.kind === "blocked";
}

export function isTutorPlanningTransition(result: TutorPlanningResult | null): result is TutorPlanningTransition {
  return result !== null && "kind" in result && result.kind === "transition";
}

export interface TutorPlanningExtension {
  resolveStrategy?(input: { readonly code?: string; readonly courseContent?: TutorPlanningContentContext }): Promise<StrategyResolution>;
  planInitial(input: { readonly code: string; readonly history: readonly TutorDialogTurn[]; readonly difficulty: TutorDifficulty; readonly exampleId?: string; readonly courseContent?: TutorPlanningContentContext }): Promise<TutorPlanningResult | null>;
  planFollowup(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly rating: TutorAnswerRating;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
  }): Promise<TutorPlanningResult | null>;
}

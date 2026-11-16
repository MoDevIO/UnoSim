import type { TutorAnswerRating, TutorDialogTurn, TutorDifficulty, TutorFocusProgress } from "@shared/tutor";
import type { TutorCapability } from "../course-content/course-content-loader";
import type { ExampleTutorAnnotation } from "../course-content/embedded-tutor-annotation";
import type { ReviewedProgram } from "./curriculum/reference-answer";
import type { EffectiveTutorStrategy, StrategyResolution } from "./strategy/effective-tutor-strategy";
import type { TutorProgressionState, DidacticPhase, ProgressionBlockedReason } from "./curriculum/progression-state";

export interface TutorPlanningContentContext {
  readonly revision: string;
  readonly tutor?: TutorCapability;
  readonly exampleId?: string;
  readonly exampleTutorAnnotation?: ExampleTutorAnnotation;
  /** The Example's reviewed program (without the annotation), the binding of its reference answers. */
  readonly exampleProgram?: ReviewedProgram;
  readonly progressionState?: TutorProgressionState;
}

/**
 * A question assignment of the aspect flow: the application chose what to ask and where, the model words
 * the question. `TutorPlan.question` then holds the wording used when the model's does not name the site.
 */
export interface TutorAssignment {
  readonly aspectId: string;
  readonly aspectTitle: string;
  readonly level: 1 | 2 | 3 | 4;
  readonly levelName: string;
  readonly task: string;
  readonly site: {
    readonly function?: string;
    readonly line: number;
    readonly endLine: number;
    readonly code: string;
    readonly names: readonly string[];
  };
  readonly graphic?: "activity";
}

/** The assignment that follows when the answer being rated receives one of `ratings`. */
export interface TutorFollowUpPreview {
  readonly ratings: readonly TutorAnswerRating[];
  readonly assignment: TutorAssignment;
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
  /** Internal normalized strategy used to build the provider prompt for this plan. */
  readonly effectiveStrategy?: EffectiveTutorStrategy;
  readonly scaffold?: { readonly id: string; readonly strategy: string; readonly hint: string };
  readonly contentRevision: string;
  readonly learningPhase?: DidacticPhase;
  readonly activeTopicId?: string;
  readonly masteredTopicIds?: readonly string[];
  readonly progressionBlockedReason?: ProgressionBlockedReason;
  readonly extensionTargetTopicId?: string;
  readonly expansionBrief?: TutorExpansionBrief;
  /** Set by the aspect flow: the model's question is kept when it names the assignment's site. */
  readonly assignment?: TutorAssignment;
  /** Aspect flow: the aspects of the sketch with assignments, and the one the learner chose. */
  readonly aspectChoices?: readonly TutorAspectChoice[];
  readonly aspectFocus?: string;
}

/** The learner's place in the teacher's focus, and what the free Tutor should still work on. */
export interface TutorFocusSummary {
  readonly progress: TutorFocusProgress;
  readonly openObjectives: readonly string[];
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
  readonly effectiveStrategy?: EffectiveTutorStrategy;
}

export interface TutorPlanningTransition {
  readonly kind: "transition";
  readonly contentRevision: string;
  readonly learningPhase: DidacticPhase;
  readonly activeTopicId?: string;
  readonly masteredTopicIds: readonly string[];
  readonly strategyId: string;
  readonly strategySource: "built-in" | "repository";
  readonly effectiveStrategy?: EffectiveTutorStrategy;
}

export type TutorPlanningResult = TutorPlan | TutorPlanningBlocked | TutorPlanningTransition;

export function isTutorPlan(result: TutorPlanningResult | null): result is TutorPlan {
  return result !== null && !("kind" in result);
}

export function isTutorPlanningBlocked(result: TutorPlanningResult | null): result is TutorPlanningBlocked {
  return result !== null && "kind" in result && result.kind === "blocked";
}

/** An aspect of the sketch the learner can choose to deepen. */
export interface TutorAspectChoice {
  readonly id: string;
  readonly title: string;
  /** `shown`: a question of level 3 or 4 was answered well; `done`: no further question is planned here. */
  readonly state: "open" | "shown" | "done";
}

export interface TutorPlanningExtension {
  focusProgress?(input: { readonly code: string; readonly courseContent?: TutorPlanningContentContext; readonly focusAsked: boolean }): TutorFocusSummary | undefined;
  resolveStrategy?(input: { readonly code?: string; readonly courseContent?: TutorPlanningContentContext }): Promise<StrategyResolution>;
  planInitial(input: { readonly code: string; readonly history: readonly TutorDialogTurn[]; readonly difficulty: TutorDifficulty; readonly exampleId?: string; readonly courseContent?: TutorPlanningContentContext }): Promise<TutorPlanningResult | null>;
  /**
   * Resolves the didactic context of the question the learner is currently answering, for the
   * dialog prompt. It never plans or reserves a new question and leaves the progression state
   * unchanged; an unresolvable question yields null. Without this method the dialog prompt
   * carries no didactic context.
   */
  planAnswered?(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
    readonly supportCycle?: boolean;
  }): Promise<TutorPlanningResult | null>;
  /**
   * The assignments that would follow the answer being rated, per rating, computed on a copy of the session
   * state. The dialog prompt carries them, so that one provider call yields the rating and the final follow-up
   * question. Absent or empty when no assignment follows (Topic catalog, focus, free Tutor).
   */
  previewFollowups?(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
    readonly supportCycle?: boolean;
  }): Promise<readonly TutorFollowUpPreview[]>;
  planFollowup(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly rating: TutorAnswerRating;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
    /** The learning-support cycle: the answered focus question stays bound to its focus (R-SUP-3). */
    readonly supportCycle?: boolean;
  }): Promise<TutorPlanningResult | null>;
  /**
   * After a weak answer the question stays open (LearningQuestions R-SUP-3): records the answer as evidence,
   * unless it was given after the reference answer was shown, and returns the plan of the same question.
   */
  planRetry?(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly rating: TutorAnswerRating;
    readonly assisted: boolean;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
  }): Promise<TutorPlanningResult | null>;
  /**
   * The question is left without evidence, by skipping or after the reference answer (R-SUP-4, R-SUP-5): it
   * counts as used, so it is not asked again right away, and adds nothing to mastery.
   */
  leaveQuestion?(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly difficulty: TutorDifficulty;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
  }): Promise<void>;
  /**
   * The graphic the application builds itself for the delivered question: the activity diagram of the
   * control statement whose head holds `siteCode`. Undefined when the question's assignment asks for none.
   */
  questionGraphic?(input: {
    readonly code: string;
    readonly currentQuestion: string;
    readonly exampleId?: string;
    readonly courseContent?: TutorPlanningContentContext;
  }): { readonly kind: "activity"; readonly siteCode: string } | undefined;
}

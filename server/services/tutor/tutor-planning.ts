import type { TutorAnswerRating, TutorDialogTurn, TutorDifficulty } from "@shared/tutor";

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
  readonly scaffold?: { readonly id: string; readonly strategy: string; readonly hint: string };
  readonly contentRevision: string;
}

export interface TutorPlanningExtension {
  planInitial(input: { readonly code: string; readonly history: readonly TutorDialogTurn[]; readonly difficulty: TutorDifficulty }): Promise<TutorPlan | null>;
  planFollowup(input: {
    readonly code: string;
    readonly history: readonly TutorDialogTurn[];
    readonly currentQuestion: string;
    readonly rating: TutorAnswerRating;
    readonly difficulty: TutorDifficulty;
  }): Promise<TutorPlan | null>;
}

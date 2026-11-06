import { z } from "zod";
import { boardIdSchema } from "./boards";
import { INPUT_LIMITS } from "./input-limits";
import { examplesRefSchema, fullCommitShaSchema, repositorySlugSchema } from "./examples";
import { projectFilesRequestFields, rejectEntryHeaderCollision } from "./schema";
import { boundedArray } from "./bounded-array";

export const tutorModelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/, "Invalid tutor model identifier");

export const TUTOR_DIFFICULTY_MIN = 1;
export const TUTOR_DIFFICULTY_MAX = 100;
export const TUTOR_DEFAULT_DIFFICULTY = 30;
export const TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY = "unoTutorConfiguredDifficulty";
export const TUTOR_ADAPTIVE_RATING_WINDOW = 4;
export const TUTOR_ADAPTIVE_MIN_STEP = -6;
export const TUTOR_ADAPTIVE_MAX_STEP = 4;

export const tutorDifficultySchema = z.number().int().min(TUTOR_DIFFICULTY_MIN).max(TUTOR_DIFFICULTY_MAX);
export type TutorDifficulty = z.infer<typeof tutorDifficultySchema>;

export const tutorAnswerRatingSchema = z.number().int().min(1).max(5);
export type TutorAnswerRating = z.infer<typeof tutorAnswerRatingSchema>;

export const TUTOR_RATING_DIFFICULTY_DELTAS: Record<TutorAnswerRating, number> = {
  1: -6,
  2: -3,
  3: 0,
  4: 2,
  5: 4,
};

export const tutorResponseStyleSchema = z.enum(["normal", "philosophical"]);

const tutorQuestionKindSchema = z.enum(["recall", "concept", "application", "prediction", "transfer"]);
const tutorLearningPhaseSchema = z.enum(["LEARN", "DEEPEN", "EXPAND"]);
export const tutorStrategySourceSchema = z.enum(["built-in", "repository"]);
export const tutorCourseContentContextSchema = z.object({
  repository: repositorySlugSchema,
  ref: examplesRefSchema,
  revision: fullCommitShaSchema,
  exampleId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/).optional(),
}).strict();
export const tutorCourseContentSessionSchema = z.uuid();
export type TutorCourseContentContext = z.infer<typeof tutorCourseContentContextSchema>;
const tutorLearningMetadataFields = {
  topicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  conceptId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  questionId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  indicatorId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  questionKind: tutorQuestionKindSchema.optional(),
  strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  strategySource: tutorStrategySourceSchema.optional(),
  contentRevision: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  learningPhase: tutorLearningPhaseSchema.optional(),
  activeTopicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  masteredTopicIds: boundedArray(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), 64).optional(),
  progressionBlockedReason: z.literal("content-exhausted").optional(),
  extensionTargetTopicId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
};

/**
 * The learner's place in the teacher's focus of an Example: `active` asks its questions, `completed` means
 * every area was understood, `open` that the questions ran out first, `paused` that the sketch no longer
 * fits the focus. The free Tutor answers in all but `active`.
 */
export const tutorFocusProgressSchema = z.object({
  state: z.enum(["active", "completed", "open", "paused"]),
  understoodAreas: z.number().int().min(0).max(8),
  totalAreas: z.number().int().min(1).max(8),
  openAreas: boundedArray(z.string().trim().min(1).max(160), 8),
}).strict();
export type TutorFocusProgress = z.infer<typeof tutorFocusProgressSchema>;

/** Own answer attempts after which the reference answer may be requested (LearningQuestions R-SUP-3). */
export const TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS = 3;
/** Answered clarification requests after which the question may be skipped (LearningQuestions R-SUP-4). */
export const TUTOR_SKIP_AFTER_CLARIFICATIONS = 2;

/** The learner's explicit actions on the asked question besides answering it (LearningQuestions 9.1). */
export const tutorSupportActionSchema = z.enum(["clarify", "hint", "reveal", "skip"]);
export type TutorSupportAction = z.infer<typeof tutorSupportActionSchema>;

/**
 * How the asked question was dealt with in this session (R-SUP-5): still `open`, `answered` on one's own,
 * `assisted` (closed after the reference answer was shown) or `skipped`.
 */
export const tutorQuestionOutcomeSchema = z.enum(["open", "answered", "assisted", "skipped"]);
export type TutorQuestionOutcome = z.infer<typeof tutorQuestionOutcomeSchema>;

/** How the server understood a typed input: an answer, a question about the question, or a request for help. */
export const tutorLearnerInputSchema = z.enum(["answer", "clarification", "help"]);
export type TutorLearnerInput = z.infer<typeof tutorLearnerInputSchema>;

const supportCountSchema = z.number().int().min(0).max(1_000);

/** The server-owned learning-support state of the asked question (LearningQuestions R-SUP-6). */
export const tutorSupportStateSchema = z.object({
  session: z.uuid(),
  questionHandle: z.uuid(),
  answerAttempts: supportCountSchema,
  clarifications: supportCountSchema,
  canRevealReference: z.boolean(),
  canSkip: z.boolean(),
  /** Whether a reviewed reference answer fits the question and the current code. */
  referenceAvailable: z.boolean(),
  /** The reference answer was shown for this question. */
  referenceShown: z.boolean(),
  outcome: tutorQuestionOutcomeSchema,
}).strict();
export type TutorSupportState = z.infer<typeof tutorSupportStateSchema>;

/** Binds an action to the server's support session and question; a retry repeats the same `actionId`. */
const tutorSupportBindingFields = {
  supportSession: z.uuid(),
  questionHandle: z.uuid(),
  actionId: z.uuid(),
};

export const tutorReferenceViewSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    answer: z.string().trim().min(1).max(300),
    explanation: z.string().trim().min(1).max(1_500),
    assumptions: boundedArray(z.string().trim().min(1).max(160), 6).optional(),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    reason: z.enum(["no-reference", "not-applicable"]),
  }).strict(),
]);
export type TutorReferenceView = z.infer<typeof tutorReferenceViewSchema>;

function withDefaultResponseStyle(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "responseStyle" in value) return value;
  return { ...value, responseStyle: "normal" };
}

const tutorContentFields = {
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  question: z.string().trim().min(1).max(2_000),
  topic: z.string().trim().min(1).max(120).optional(),
  difficulty: tutorDifficultySchema.optional(),
  mermaid: z.string().trim().min(1).max(12_000).optional(),
  focusProgress: tutorFocusProgressSchema.optional(),
  ...tutorLearningMetadataFields,
};

const tutorNormalContentResultSchema = z.object({
  ...tutorContentFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
}).strict();

const tutorPhilosophicalContentResultSchema = z.object({
  ...tutorContentFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
}).strict();

const tutorContentResultUnionSchema = z.discriminatedUnion("responseStyle", [
  tutorNormalContentResultSchema,
  tutorPhilosophicalContentResultSchema,
]);

export function clampTutorDifficulty(value: number): TutorDifficulty {
  const normalized = Number.isFinite(value) ? Math.round(value) : TUTOR_DEFAULT_DIFFICULTY;
  return Math.min(TUTOR_DIFFICULTY_MAX, Math.max(TUTOR_DIFFICULTY_MIN, normalized));
}

export function calculateNextTutorDifficulty(
  currentDifficulty: TutorDifficulty,
  ratings: readonly TutorAnswerRating[],
): TutorDifficulty {
  const recentRatings = ratings.slice(-TUTOR_ADAPTIVE_RATING_WINDOW);
  if (recentRatings.length === 0) return currentDifficulty;

  const weightedSum = recentRatings.reduce((sum, rating, index) => sum + TUTOR_RATING_DIFFICULTY_DELTAS[rating] * (index + 1), 0);
  const weightSum = recentRatings.reduce((sum, _rating, index) => sum + index + 1, 0);
  const dampedStep = Math.max(TUTOR_ADAPTIVE_MIN_STEP, Math.min(TUTOR_ADAPTIVE_MAX_STEP, Math.round(weightedSum / weightSum)));
  return clampTutorDifficulty(currentDifficulty + dampedStep);
}

export const tutorQuestionRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    /** Header files and entry file name of the project, as in `POST /api/compile`; `code` is the entry file. */
    ...projectFilesRequestFields,
    /** Board the sketch is written for; the Tutor's context then names it, its data type sizes and its pins. */
    board: boardIdSchema.optional(),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
    /** Opts into the learning-support cycle (LearningQuestions 3.10); the response then carries `support`. */
    learningSupport: z.literal(true).optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision);

export const tutorModelsRequestSchema = z
  .object({
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
  })
  .strict();

export const tutorModelsResponseSchema = z
  .object({
    models: boundedArray(tutorModelSchema, 256),
  })
  .strict();

export const tutorContentResultSchema = z.preprocess(withDefaultResponseStyle, tutorContentResultUnionSchema);

export type TutorContentResult = z.infer<typeof tutorContentResultSchema>;

const tutorDialogFields = {
  question: z.string().trim().min(1).max(2_000),
  answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
  feedback: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  ...tutorLearningMetadataFields,
};

const tutorNormalDialogTurnSchema = z.object({
  ...tutorDialogFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
}).strict();

const tutorPhilosophicalDialogTurnSchema = z.object({
  ...tutorDialogFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
}).strict();

export const tutorDialogTurnSchema = z.preprocess(
  withDefaultResponseStyle,
  z.discriminatedUnion("responseStyle", [tutorNormalDialogTurnSchema, tutorPhilosophicalDialogTurnSchema]),
);

export type TutorDialogTurn = z.infer<typeof tutorDialogTurnSchema>;

export const tutorDialogRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    ...projectFilesRequestFields,
    board: boardIdSchema.optional(),
    history: boundedArray(tutorDialogTurnSchema, INPUT_LIMITS.tutor.maxHistoryEntries),
    question: z.string().trim().min(1).max(2_000),
    answer: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxAnswerChars),
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
    // Compatibility rule (LearningQuestions 9.1): without these three fields the dialog keeps the MVP behavior.
    supportSession: tutorSupportBindingFields.supportSession.optional(),
    questionHandle: tutorSupportBindingFields.questionHandle.optional(),
    actionId: tutorSupportBindingFields.actionId.optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision)
  .superRefine((value, context) => {
    const bound = [value.supportSession, value.questionHandle, value.actionId].filter((field) => field !== undefined).length;
    if (bound !== 0 && bound !== 3) {
      context.addIssue({ code: "custom", path: ["supportSession"], message: "supportSession, questionHandle and actionId belong together" });
    }
  });

/** An explicit support action on the asked question; it carries no learner answer (LearningQuestions 9.1). */
export const tutorSupportRequestSchema = z
  .object({
    code: z.string().min(1).max(INPUT_LIMITS.compile.maxCodeChars),
    ...projectFilesRequestFields,
    board: boardIdSchema.optional(),
    history: boundedArray(tutorDialogTurnSchema, INPUT_LIMITS.tutor.maxHistoryEntries),
    action: tutorSupportActionSchema,
    ...tutorSupportBindingFields,
    credential: z.string().min(1).max(INPUT_LIMITS.tutor.maxCredentialChars).optional(),
    model: tutorModelSchema.optional(),
    difficulty: tutorDifficultySchema.default(TUTOR_DEFAULT_DIFFICULTY),
    courseContent: tutorCourseContentContextSchema.optional(),
    courseContentSession: tutorCourseContentSessionSchema.optional(),
  })
  .strict()
  .superRefine(rejectEntryHeaderCollision);
export type TutorSupportRequest = z.infer<typeof tutorSupportRequestSchema>;

const tutorResponseFields = {
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  courseContentSession: tutorCourseContentSessionSchema.optional(),
  /** Present when the request opted into the learning-support cycle. */
  support: tutorSupportStateSchema.optional(),
  /** How a typed input was understood; only `answer` is rated. */
  learnerInput: tutorLearnerInputSchema.optional(),
};

const tutorNormalResponseSchema = z.object({
  ...tutorContentFields,
  answerRating: tutorAnswerRatingSchema.optional(),
  responseStyle: z.literal("normal"),
  ...tutorResponseFields,
}).strict();

const tutorPhilosophicalResponseSchema = z.object({
  ...tutorContentFields,
  answerRating: z.never().optional(),
  responseStyle: z.literal("philosophical"),
  ...tutorResponseFields,
}).strict();

export const tutorResponseSchema = z.preprocess(
  withDefaultResponseStyle,
  z.discriminatedUnion("responseStyle", [tutorNormalResponseSchema, tutorPhilosophicalResponseSchema]),
);

export type TutorResponse = z.infer<typeof tutorResponseSchema>;

/** The next question after a skip; its learning metadata as in a question response. */
const tutorNextQuestionSchema = z.object({
  ...tutorContentFields,
  responseStyle: z.literal("normal"),
}).strict();

/**
 * The result of a support action (LearningQuestions 9.1): `explanation` for clarify and hint, `reference` for
 * reveal, and for skip either the `next` question or `completed` with the open areas. None carries a rating.
 */
export const tutorSupportResponseSchema = z.object({
  action: tutorSupportActionSchema,
  explanation: z.string().trim().min(1).max(INPUT_LIMITS.tutor.maxFeedbackChars).optional(),
  reference: tutorReferenceViewSchema.optional(),
  next: tutorNextQuestionSchema.optional(),
  completed: z.literal(true).optional(),
  focusProgress: tutorFocusProgressSchema.optional(),
  support: tutorSupportStateSchema.optional(),
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  courseContentSession: tutorCourseContentSessionSchema.optional(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  if ((value.action === "clarify" || value.action === "hint") && value.explanation === undefined) issue(`${value.action} needs an explanation`);
  if (value.action === "reveal" && value.reference === undefined) issue("reveal needs a reference view");
  if (value.action !== "reveal" && value.reference !== undefined) issue("only reveal shows a reference");
  if (value.action === "skip" && (value.next === undefined) === (value.completed === undefined)) issue("skip needs either next or completed");
  if (value.action !== "skip" && (value.next !== undefined || value.completed !== undefined)) issue("only skip moves to another question");
  if (value.action !== "skip" && value.support === undefined) issue(`${value.action} needs the support state`);
});
export type TutorSupportResponse = z.infer<typeof tutorSupportResponseSchema>;

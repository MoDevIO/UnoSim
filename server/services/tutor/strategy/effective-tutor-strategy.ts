import { z } from "zod";

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

const questionKindWeightsSchema = z.object({
  recall: z.number().int().min(0).max(100),
  concept: z.number().int().min(0).max(100),
  application: z.number().int().min(0).max(100),
  prediction: z.number().int().min(0).max(100),
  transfer: z.number().int().min(0).max(100),
}).strict().refine(
  (value) => Object.values(value).reduce((sum, weight) => sum + weight, 0) === 100,
  "Question-kind weights must sum to 100",
);

export const effectiveTutorStrategySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(SAFE_ID),
  questionKindWeights: questionKindWeightsSchema,
  sketchSpecificity: z.enum(["prefer", "strict"]),
  repetition: z.enum(["strict", "relaxed"]),
  remediation: z.enum(["scaffold-first", "question-first"]),
  clarification: z.enum(["same-indicator", "new-indicator"]),
  progression: z.enum(["mastery-then-advance", "advance-immediately"]),
  scaffolding: z.enum(["prefer-content", "prefer-generated"]),
  feedbackVerbosity: z.enum(["short", "detailed"]),
  hintFirst: z.boolean(),
  adaptiveDifficulty: z.literal("current-contract"),
}).strict();

export type EffectiveTutorStrategy = z.infer<typeof effectiveTutorStrategySchema>;
export type TutorStrategyResolutionSource = "example" | "repository" | "built-in";

export const BUILT_IN_TUTOR_STRATEGY: EffectiveTutorStrategy = {
  schemaVersion: 1,
  id: "built-in-default",
  questionKindWeights: {
    recall: 10,
    concept: 25,
    application: 35,
    prediction: 15,
    transfer: 15,
  },
  sketchSpecificity: "prefer",
  repetition: "strict",
  remediation: "scaffold-first",
  clarification: "same-indicator",
  progression: "mastery-then-advance",
  scaffolding: "prefer-content",
  feedbackVerbosity: "short",
  hintFirst: true,
  adaptiveDifficulty: "current-contract",
};

export type StrategyResolution = {
  readonly strategy: EffectiveTutorStrategy;
  readonly source: TutorStrategyResolutionSource;
};

export function resolveEffectiveTutorStrategy(input: {
  readonly perExample?: unknown;
  readonly repositoryDefault?: unknown;
}): StrategyResolution {
  const candidates: readonly { value: unknown; source: TutorStrategyResolutionSource }[] = [
    { value: input.perExample, source: "example" },
    { value: input.repositoryDefault, source: "repository" },
    { value: BUILT_IN_TUTOR_STRATEGY, source: "built-in" },
  ];
  for (const candidate of candidates) {
    const parsed = effectiveTutorStrategySchema.safeParse(candidate.value);
    if (parsed.success) return { strategy: parsed.data, source: candidate.source };
  }
  throw new Error("Built-in Tutor strategy is invalid");
}

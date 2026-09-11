import { z } from "zod";

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/i;

const hasControlCharacters = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) return true;
  }
  return false;
};

const boundedText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !hasControlCharacters(value), "Control characters are not allowed")
  .refine((value) => !/https?:\/\//i.test(value), "URLs are not allowed in curriculum text");

const idSchema = z.string().regex(SAFE_ID);
const questionKindSchema = z.enum(["recall", "concept", "application", "prediction", "transfer"]);
const strategySchema = z.enum(["concrete-model", "smaller-subproblem", "perspective-change", "prerequisite"]);
const factKindSchema = z.enum(["type-used", "array-declared", "serial-call"]);

export const factRequirementSchema = z.object({
  fact: factKindSchema,
  values: z.array(boundedText(64)).max(12).optional(),
  elementTypes: z.array(boundedText(64)).max(12).optional(),
}).strict().refine(
  (value) => value.values !== undefined || value.elementTypes !== undefined || value.fact === "array-declared",
  "Fact requirements need a bounded value selector",
);

const activationSchema = z.object({
  any: z.array(factRequirementSchema).min(1).max(16),
}).strict();

const difficultyRangeSchema = z.tuple([
  z.number().int().min(1).max(100),
  z.number().int().min(1).max(100),
]).refine(([min, max]) => min <= max, "Difficulty range must be ordered");

const misconceptionSchema = z.object({
  id: idSchema,
  description: boundedText(500),
}).strict();

const indicatorSchema = z.object({
  id: idSchema,
  description: boundedText(500),
}).strict();

const masterySchema = z.object({
  minimumSuccessfulProbes: z.number().int().min(1).max(10),
  successRatingAtLeast: z.number().int().min(3).max(5),
  requiredIndicators: z.array(idSchema).min(1).max(12),
  minimumDistinctQuestionKinds: z.number().int().min(1).max(5),
  recentWeakAnswersAllowed: z.number().int().min(0).max(3),
}).strict();

const conceptSchema = z.object({
  id: idSchema,
  title: boundedText(160),
  objective: boundedText(1_000),
  prerequisites: z.array(idSchema).max(8),
  difficulty: z.object({
    entry: difficultyRangeSchema,
    transfer: difficultyRangeSchema,
  }).strict(),
  misconceptions: z.array(misconceptionSchema).max(16),
  indicators: z.array(indicatorSchema).min(1).max(12),
  mastery: masterySchema,
}).strict();

const questionSchema = z.object({
  id: idSchema,
  concept: idSchema,
  indicator: idSchema,
  kind: questionKindSchema,
  difficulty: difficultyRangeSchema,
  requires: z.array(factRequirementSchema).min(1).max(8),
  text: boundedText(1_000).optional(),
  template: boundedText(1_000).optional(),
  slots: z.array(idSchema).max(8).optional(),
}).strict().superRefine((value, context) => {
  if ((value.text === undefined) === (value.template === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Exactly one of text or template is required" });
  }
  if (value.template === undefined && value.slots !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Slots require a template" });
  }
});

const scaffoldSchema = z.object({
  id: idSchema,
  forConcept: idSchema,
  strategy: strategySchema,
  level: z.number().int().min(1).max(3),
  hint: boundedText(700),
  nextQuestion: idSchema,
  targetConcept: idSchema.optional(),
}).strict();

const progressionSchema = z.object({
  entryConcepts: z.array(idSchema).min(1).max(8),
  preferredOrder: z.array(idSchema).min(1).max(32),
  onRating: z.object({
    "1-2": z.literal("remediate"),
    "3": z.literal("clarify-same-indicator"),
    "4": z.literal("probe-missing-indicator"),
    "5": z.literal("evaluate-mastery-and-advance"),
  }).strict(),
}).strict();

export const curriculumTopicSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("memory-and-data-types"),
  title: boundedText(160),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  activation: activationSchema,
  concepts: z.array(conceptSchema).min(1).max(16),
  questions: z.array(questionSchema).min(1).max(64),
  scaffolds: z.array(scaffoldSchema).max(32),
  progression: progressionSchema,
}).strict();

export const curriculumManifestSchema = z.object({
  schemaVersion: z.literal(1),
  curriculumId: idSchema,
  release: boundedText(64),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  topics: z.array(z.object({
    id: z.literal("memory-and-data-types"),
    path: z.string().regex(/^topics\/[a-z][a-z0-9-]{0,63}\.yaml$/),
    sha256: z.string().regex(SAFE_SHA256),
  }).strict()).length(1),
}).strict();

export type FactRequirement = z.infer<typeof factRequirementSchema>;
export type CurriculumTopic = z.infer<typeof curriculumTopicSchema>;
export type CurriculumManifest = z.infer<typeof curriculumManifestSchema>;
export type CurriculumConcept = CurriculumTopic["concepts"][number];
export type CurriculumQuestion = CurriculumTopic["questions"][number];
export type CurriculumScaffold = CurriculumTopic["scaffolds"][number];

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function assertAcyclic(concepts: readonly CurriculumConcept[]): void {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  for (const concept of concepts) {
    for (const prerequisite of concept.prerequisites) {
      if (!byId.has(prerequisite)) throw new Error(`Unknown prerequisite: ${prerequisite}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Cyclic concept dependency at: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const concept of concepts) visit(concept.id);
}

export function validateCurriculumTopic(topic: CurriculumTopic): CurriculumTopic {
  assertUnique(topic.concepts.map((concept) => concept.id), "concept id");
  assertUnique(topic.questions.map((question) => question.id), "question id");
  assertUnique(topic.scaffolds.map((scaffold) => scaffold.id), "scaffold id");
  assertAcyclic(topic.concepts);

  const concepts = new Map(topic.concepts.map((concept) => [concept.id, concept]));
  const questions = new Map(topic.questions.map((question) => [question.id, question]));
  const conceptIndicators = new Map(topic.concepts.map((concept) => [concept.id, new Set(concept.indicators.map((indicator) => indicator.id))]));

  validateQuestions(topic.questions, concepts, conceptIndicators);
  validateMastery(topic.concepts, conceptIndicators);
  validateScaffolds(topic.scaffolds, concepts, new Set(questions.keys()));
  validateProgression(topic.progression, concepts);
  return topic;
}

function validateQuestions(
  questions: readonly CurriculumQuestion[],
  concepts: ReadonlyMap<string, CurriculumConcept>,
  conceptIndicators: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const question of questions) {
    if (!concepts.has(question.concept)) throw new Error(`Question references unknown concept: ${question.id}`);
    if (!conceptIndicators.get(question.concept)?.has(question.indicator)) {
      throw new Error(`Question references unknown indicator: ${question.id}`);
    }
    if (question.template !== undefined) {
      for (const slot of question.slots ?? []) {
        if (!/^([a-z][a-z0-9-]{0,63})$/.test(slot)) throw new Error(`Invalid question slot: ${slot}`);
      }
    }
  }

}

function validateMastery(concepts: readonly CurriculumConcept[], conceptIndicators: ReadonlyMap<string, ReadonlySet<string>>): void {
  for (const concept of concepts) {
    for (const indicator of concept.mastery.requiredIndicators) {
      if (!conceptIndicators.get(concept.id)?.has(indicator)) {
        throw new Error(`Mastery references unknown indicator: ${concept.id}/${indicator}`);
      }
    }
  }

}

function validateScaffolds(
  scaffolds: readonly CurriculumScaffold[],
  concepts: ReadonlyMap<string, CurriculumConcept>,
  questionIds: ReadonlySet<string>,
): void {
  for (const scaffold of scaffolds) {
    if (!concepts.has(scaffold.forConcept)) throw new Error(`Scaffold references unknown concept: ${scaffold.id}`);
    if (!questionIds.has(scaffold.nextQuestion)) throw new Error(`Scaffold references unknown question: ${scaffold.id}`);
    if (scaffold.targetConcept !== undefined && !concepts.has(scaffold.targetConcept)) {
      throw new Error(`Scaffold references unknown target concept: ${scaffold.id}`);
    }
  }

}

function validateProgression(
  progression: CurriculumTopic["progression"],
  concepts: ReadonlyMap<string, CurriculumConcept>,
): void {
  for (const conceptId of [...progression.entryConcepts, ...progression.preferredOrder]) {
    if (!concepts.has(conceptId)) throw new Error(`Progression references unknown concept: ${conceptId}`);
  }
}

export function validateCurriculumManifest(manifest: CurriculumManifest): CurriculumManifest {
  assertUnique(manifest.topics.map((topic) => topic.id), "topic id");
  return manifest;
}

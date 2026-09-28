import type { TutorDialogTurn } from "@shared/tutor";
import type { CurriculumConcept, CurriculumQuestion, CurriculumTopic } from "../tutor/curriculum/curriculum-schema";
import {
  classifyTopic,
  collectObservations,
  DefaultLearningPlanner,
  questionApplies,
} from "../tutor/curriculum/learning-planner";
import { deepeningCriteria, hasMetDeepeningCriteria } from "../tutor/curriculum/progression-state";
import { DefaultSketchFactExtractor, type SketchFacts } from "../tutor/curriculum/sketch-facts";
import { DefaultTopicMatcher } from "../tutor/curriculum/topic-matcher";
import { BUILT_IN_TUTOR_STRATEGY, type EffectiveTutorStrategy } from "../tutor/strategy/effective-tutor-strategy";

export interface ResolvedTutorQualityCase {
  readonly id: string;
  readonly exampleId: string;
  readonly code: string;
  readonly expectedTopics: readonly string[];
  readonly forbiddenTopics: readonly string[];
  readonly learnStrategy?: EffectiveTutorStrategy;
  readonly deepenStrategy?: EffectiveTutorStrategy;
}

export type TutorContentQualityIssueCode =
  | "expected-topic-not-activated"
  | "forbidden-topic-activated"
  | "missing-positive-activation-case"
  | "missing-negative-activation-case"
  | "unknown-topic-reference"
  | "unreachable-concept"
  | "unreachable-indicator"
  | "unreachable-prerequisite"
  | "insufficient-mastery-probes"
  | "insufficient-mastery-question-kinds"
  | "missing-mastery-indicator-question"
  | "missing-deepening-question-kind"
  | "learn-content-exhausted"
  | "deepen-content-exhausted"
  | "invalid-course-content-bundle"
  | "invalid-quality-cases"
  | "quality-case-example-not-found";

export interface TutorContentQualityIssue {
  readonly code: TutorContentQualityIssueCode;
  readonly message: string;
  readonly caseId?: string;
  readonly topicId?: string;
  readonly conceptId?: string;
  readonly indicatorId?: string;
}

type CaseContext = {
  readonly qualityCase: ResolvedTutorQualityCase;
  readonly facts: SketchFacts;
  readonly activatedTopicIds: ReadonlySet<string>;
};

export function validateTutorContentQuality(
  topics: readonly CurriculumTopic[],
  qualityCases: readonly ResolvedTutorQualityCase[],
): TutorContentQualityIssue[] {
  const extractor = new DefaultSketchFactExtractor();
  const matcher = new DefaultTopicMatcher();
  const topicIds = new Set(topics.map(({ id }) => id));
  const contexts = qualityCases.map((qualityCase): CaseContext => {
    const facts = extractor.extract(qualityCase.code);
    return {
      qualityCase,
      facts,
      activatedTopicIds: new Set(matcher.match(topics, facts).map(({ topic }) => topic.id)),
    };
  });
  const issues: TutorContentQualityIssue[] = [];

  validateActivationReferences(contexts, topicIds, issues);
  for (const topic of topics) validateTopic(topic, contexts, issues);
  return issues;
}

function validateActivationReferences(
  contexts: readonly CaseContext[],
  topicIds: ReadonlySet<string>,
  issues: TutorContentQualityIssue[],
): void {
  for (const { qualityCase, activatedTopicIds } of contexts) {
    validateUnknownTopicReferences(qualityCase, topicIds, issues);
    validateExpectedTopicActivation(qualityCase, activatedTopicIds, topicIds, issues);
    validateForbiddenTopicActivation(qualityCase, activatedTopicIds, topicIds, issues);
  }
}

function validateUnknownTopicReferences(
  qualityCase: ResolvedTutorQualityCase,
  topicIds: ReadonlySet<string>,
  issues: TutorContentQualityIssue[],
): void {
  for (const topicId of [...qualityCase.expectedTopics, ...qualityCase.forbiddenTopics]) {
    if (!topicIds.has(topicId)) {
      issues.push(issue("unknown-topic-reference", `Quality case references unknown Topic ${topicId}`, qualityCase.id, topicId));
    }
  }
}

function validateExpectedTopicActivation(
  qualityCase: ResolvedTutorQualityCase,
  activatedTopicIds: ReadonlySet<string>,
  topicIds: ReadonlySet<string>,
  issues: TutorContentQualityIssue[],
): void {
  for (const topicId of qualityCase.expectedTopics) {
    if (topicIds.has(topicId) && !activatedTopicIds.has(topicId)) {
      issues.push(issue("expected-topic-not-activated", `Expected Topic ${topicId} is not activated`, qualityCase.id, topicId));
    }
  }
}

function validateForbiddenTopicActivation(
  qualityCase: ResolvedTutorQualityCase,
  activatedTopicIds: ReadonlySet<string>,
  topicIds: ReadonlySet<string>,
  issues: TutorContentQualityIssue[],
): void {
  for (const topicId of qualityCase.forbiddenTopics) {
    if (topicIds.has(topicId) && activatedTopicIds.has(topicId)) {
      issues.push(issue("forbidden-topic-activated", `Forbidden Topic ${topicId} is activated`, qualityCase.id, topicId));
    }
  }
}

function validateTopic(
  topic: CurriculumTopic,
  contexts: readonly CaseContext[],
  issues: TutorContentQualityIssue[],
): void {
  const positive = contexts.filter(({ qualityCase }) => qualityCase.expectedTopics.includes(topic.id));
  const negative = contexts.filter(({ qualityCase }) => qualityCase.forbiddenTopics.includes(topic.id));
  if (positive.length === 0) {
    issues.push(issue("missing-positive-activation-case", `Topic ${topic.id} has no positive activation case`, undefined, topic.id));
  }
  if (negative.length === 0) {
    issues.push(issue("missing-negative-activation-case", `Topic ${topic.id} has no negative activation case`, undefined, topic.id));
  }

  validateGlobalReachability(topic, positive, issues);
  for (const context of positive) {
    if (!context.activatedTopicIds.has(topic.id)) continue;
    validateCaseStructure(topic, context, issues);
    validateExecutablePath(topic, context, issues);
  }
}

function validateGlobalReachability(
  topic: CurriculumTopic,
  contexts: readonly CaseContext[],
  issues: TutorContentQualityIssue[],
): void {
  const applicable = topic.questions.filter((question) => contexts.some(({ facts }) => questionApplies(question, facts)));
  for (const concept of topic.concepts) {
    const conceptQuestions = applicable.filter((question) => question.concept === concept.id);
    if (conceptQuestions.length === 0) {
      issues.push(issue("unreachable-concept", `Concept ${concept.id} has no applicable question in any positive case`, undefined, topic.id, concept.id));
    }
    for (const indicator of concept.indicators) {
      if (!conceptQuestions.some((question) => question.indicator === indicator.id)) {
        issues.push(issue("unreachable-indicator", `Indicator ${indicator.id} has no applicable question in any positive case`, undefined, topic.id, concept.id, indicator.id));
      }
    }
  }
}

function validateCaseStructure(
  topic: CurriculumTopic,
  context: CaseContext,
  issues: TutorContentQualityIssue[],
): void {
  const applicable = topic.questions.filter((question) => questionApplies(question, context.facts));
  const domain = new Set(applicable.map(({ concept }) => concept));
  for (const concept of topic.concepts.filter(({ id }) => domain.has(id))) {
    const questions = applicable.filter((question) => question.concept === concept.id);
    validatePrerequisites(topic, concept, domain, context, issues);
    validateMasteryCapacity(topic, concept, questions, context, issues);
  }
  const criteria = deepeningCriteria(topic);
  for (const kind of criteria.requiredQuestionKinds) {
    if (!applicable.some((question) => question.kind === kind)) {
      issues.push(issue("missing-deepening-question-kind", `DEEPEN requires unavailable question kind ${kind}`, context.qualityCase.id, topic.id));
    }
  }
}

function validatePrerequisites(
  topic: CurriculumTopic,
  concept: CurriculumConcept,
  domain: ReadonlySet<string>,
  context: CaseContext,
  issues: TutorContentQualityIssue[],
): void {
  for (const prerequisite of concept.prerequisites) {
    if (!domain.has(prerequisite)) {
      issues.push(issue("unreachable-prerequisite", `Concept ${concept.id} requires unprobeable Concept ${prerequisite}`, context.qualityCase.id, topic.id, concept.id));
    }
  }
}

function validateMasteryCapacity(
  topic: CurriculumTopic,
  concept: CurriculumConcept,
  questions: readonly CurriculumQuestion[],
  context: CaseContext,
  issues: TutorContentQualityIssue[],
): void {
  if (questions.length < concept.mastery.minimumSuccessfulProbes) {
    issues.push(issue("insufficient-mastery-probes", `Concept ${concept.id} has too few distinct applicable mastery probes`, context.qualityCase.id, topic.id, concept.id));
  }
  if (new Set(questions.map(({ kind }) => kind)).size < concept.mastery.minimumDistinctQuestionKinds) {
    issues.push(issue("insufficient-mastery-question-kinds", `Concept ${concept.id} has too few applicable question kinds`, context.qualityCase.id, topic.id, concept.id));
  }
  for (const indicator of concept.mastery.requiredIndicators) {
    if (!questions.some((question) => question.indicator === indicator)) {
      issues.push(issue("missing-mastery-indicator-question", `Mastery Indicator ${indicator} has no applicable question`, context.qualityCase.id, topic.id, concept.id, indicator));
    }
  }
}

function validateExecutablePath(
  topic: CurriculumTopic,
  context: CaseContext,
  issues: TutorContentQualityIssue[],
): void {
  const planner = new DefaultLearningPlanner();
  const history: TutorDialogTurn[] = [];
  let masteryReached = false;
  for (let step = 0; step <= topic.questions.length; step += 1) {
    const observations = collectObservations(topic, history);
    const classification = classifyTopic(
      topic,
      context.facts,
      observations,
      new Set(history.flatMap(({ questionId }) => questionId ? [questionId] : [])),
      30,
      context.qualityCase.learnStrategy ?? BUILT_IN_TUTOR_STRATEGY,
    );
    if (classification.status === "mastered") {
      masteryReached = true;
      break;
    }
    const plan = planner.start(
      topic,
      "0".repeat(40),
      context.facts,
      history,
      30,
      context.qualityCase.learnStrategy ?? BUILT_IN_TUTOR_STRATEGY,
    );
    if (!plan) break;
    history.push(successfulTurn(plan.brief));
  }
  if (!masteryReached) {
    issues.push(issue("learn-content-exhausted", "Default strict progression cannot reach Topic mastery", context.qualityCase.id, topic.id));
    return;
  }

  const postMastery = [] as Array<{
    questionId: string;
    conceptId: string;
    indicatorId: string;
    kind: CurriculumQuestion["kind"];
    rating: 5;
  }>;
  const criteria = deepeningCriteria(topic);
  for (let step = 0; step <= topic.questions.length; step += 1) {
    if (hasMetDeepeningCriteria(topic, postMastery)) return;
    const plan = planner.start(topic, "0".repeat(40), context.facts, history, 30, context.qualityCase.deepenStrategy ?? BUILT_IN_TUTOR_STRATEGY, {
      phase: "DEEPEN",
      preferredQuestionKinds: criteria.requiredQuestionKinds,
      existingQuestionKinds: postMastery.map(({ kind }) => kind),
    });
    if (!plan) break;
    history.push(successfulTurn(plan.brief));
    postMastery.push({
      questionId: plan.brief.questionId,
      conceptId: plan.brief.conceptId,
      indicatorId: plan.brief.indicatorId,
      kind: plan.brief.questionKind,
      rating: 5,
    });
  }
  issues.push(issue("deepen-content-exhausted", "Default strict progression cannot satisfy DEEPEN", context.qualityCase.id, topic.id));
}

function successfulTurn(brief: {
  readonly question: string;
  readonly questionId: string;
  readonly topicId: string;
  readonly conceptId: string;
  readonly indicatorId: string;
  readonly questionKind: CurriculumQuestion["kind"];
}): TutorDialogTurn {
  return {
    question: brief.question,
    questionId: brief.questionId,
    topicId: brief.topicId,
    conceptId: brief.conceptId,
    indicatorId: brief.indicatorId,
    questionKind: brief.questionKind,
    answer: "Deterministic successful quality probe",
    answerRating: 5,
    responseStyle: "normal",
  };
}

function issue(
  code: TutorContentQualityIssueCode,
  message: string,
  caseId?: string,
  topicId?: string,
  conceptId?: string,
  indicatorId?: string,
): TutorContentQualityIssue {
  return {
    code,
    message,
    ...(caseId ? { caseId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(conceptId ? { conceptId } : {}),
    ...(indicatorId ? { indicatorId } : {}),
  };
}

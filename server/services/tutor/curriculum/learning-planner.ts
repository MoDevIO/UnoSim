import type { TutorDialogTurn, TutorDifficulty, TutorAnswerRating } from "@shared/tutor";
import type {
  CurriculumConcept,
  CurriculumQuestion,
  CurriculumScaffold,
  CurriculumTopic,
} from "./curriculum-schema";
import { matchesFactRequirement, type SketchFacts } from "./sketch-facts";

export interface DidacticBrief {
  readonly topicId: string;
  readonly topicTitle: string;
  readonly conceptId: string;
  readonly conceptTitle: string;
  readonly objective: string;
  readonly questionId: string;
  readonly questionKind: CurriculumQuestion["kind"];
  readonly indicatorId: string;
  readonly indicator: string;
  readonly question: string;
  readonly misconceptions: readonly { id: string; description: string }[];
  readonly strategyId?: string;
  readonly scaffold?: { id: string; strategy: CurriculumScaffold["strategy"]; hint: string };
}

export interface LearningPlan {
  readonly brief: DidacticBrief;
  readonly contentRevision: string;
}

export interface LearningPlanner {
  start(
    topic: CurriculumTopic,
    revision: string,
    facts: SketchFacts,
    history: readonly TutorDialogTurn[],
    difficulty: TutorDifficulty,
  ): LearningPlan | null;
  advance(
    topic: CurriculumTopic,
    revision: string,
    facts: SketchFacts,
    history: readonly TutorDialogTurn[],
    currentQuestion: string,
    rating: TutorAnswerRating,
    difficulty: TutorDifficulty,
  ): LearningPlan | null;
}

type Observation = {
  questionId: string;
  conceptId: string;
  indicatorId: string;
  kind: CurriculumQuestion["kind"];
  rating: TutorAnswerRating;
};

export class DefaultLearningPlanner implements LearningPlanner {
  start(
    topic: CurriculumTopic,
    revision: string,
    facts: SketchFacts,
    history: readonly TutorDialogTurn[],
    difficulty: TutorDifficulty,
  ): LearningPlan | null {
    const observations = collectObservations(topic, history);
    const usedQuestionIds = collectUsedQuestionIds(topic, history);
    const concept = selectNextConcept(topic, facts, observations, usedQuestionIds);
    if (!concept) return null;
    const question = selectQuestion(topic, concept, facts, usedQuestionIds, difficulty);
    return question ? buildPlan(topic, revision, concept, question) : null;
  }

  advance(
    topic: CurriculumTopic,
    revision: string,
    facts: SketchFacts,
    history: readonly TutorDialogTurn[],
    currentQuestion: string,
    rating: TutorAnswerRating,
    difficulty: TutorDifficulty,
  ): LearningPlan | null {
    const observations = collectObservations(topic, history);
    const current = findQuestion(topic, currentQuestion, history);
    if (!current) return null;
    const allObservations = [...observations, {
      questionId: current.question.id,
      conceptId: current.question.concept,
      indicatorId: current.question.indicator,
      kind: current.question.kind,
      rating,
    }];
    const usedQuestionIds = new Set([...collectUsedQuestionIds(topic, history), current.question.id]);
    const concept = topic.concepts.find(({ id }) => id === current.question.concept);
    if (!concept) return null;

    const next = selectAfterRating(topic, facts, concept, current.question, rating, allObservations, usedQuestionIds, difficulty);
    return next ? buildPlan(topic, revision, next.concept, next.question, next.scaffold) : null;
  }
}

function buildPlan(
  topic: CurriculumTopic,
  revision: string,
  concept: CurriculumConcept,
  question: CurriculumQuestion,
  scaffold?: CurriculumScaffold,
): LearningPlan {
  const indicator = concept.indicators.find(({ id }) => id === question.indicator);
  return {
    contentRevision: revision,
    brief: {
      topicId: topic.id,
      topicTitle: topic.title,
      conceptId: concept.id,
      conceptTitle: concept.title,
      objective: concept.objective,
      questionId: question.id,
      questionKind: question.kind,
      indicatorId: question.indicator,
      indicator: indicator?.description ?? "",
      question: question.text ?? question.template ?? "",
      misconceptions: concept.misconceptions,
      ...(scaffold ? { strategyId: scaffold.id } : {}),
      ...(scaffold ? { scaffold: { id: scaffold.id, strategy: scaffold.strategy, hint: scaffold.hint } } : {}),
    },
  };
}

export function describeQuestion(
  topic: CurriculumTopic,
  revision: string,
  questionText: string,
): LearningPlan | null {
  const question = topic.questions.find((candidate) => candidate.text === questionText);
  const concept = question ? topic.concepts.find((candidate) => candidate.id === question.concept) : undefined;
  return question && concept ? buildPlan(topic, revision, concept, question) : null;
}

function collectUsedQuestionIds(topic: CurriculumTopic, history: readonly TutorDialogTurn[]): Set<string> {
  const byText = new Map(topic.questions.flatMap((question) => question.text ? [[question.text, question.id] as const] : []));
  return new Set(history.flatMap((turn) => turn.questionId ? [turn.questionId] : (byText.has(turn.question) ? [byText.get(turn.question)!] : [])));
}

function collectObservations(topic: CurriculumTopic, history: readonly TutorDialogTurn[]): Observation[] {
  const byId = new Map(topic.questions.map((question) => [question.id, question]));
  const byText = new Map(topic.questions.flatMap((question) => question.text ? [[question.text, question] as const] : []));
  return history.flatMap((turn) => {
    if (turn.answerRating === undefined) return [];
    const question = (turn.questionId ? byId.get(turn.questionId) : undefined) ?? byText.get(turn.question);
    return question ? [{ questionId: question.id, conceptId: question.concept, indicatorId: question.indicator, kind: question.kind, rating: turn.answerRating }] : [];
  });
}

function findQuestion(
  topic: CurriculumTopic,
  currentQuestion: string,
  history: readonly TutorDialogTurn[],
): { question: CurriculumQuestion } | null {
  const questionId = history.find((turn) => turn.question === currentQuestion)?.questionId;
  const question = (questionId ? topic.questions.find((candidate) => candidate.id === questionId) : undefined)
    ?? topic.questions.find((candidate) => candidate.text === currentQuestion);
  return question ? { question } : null;
}

function selectNextConcept(
  topic: CurriculumTopic,
  facts: SketchFacts,
  observations: readonly Observation[],
  usedQuestionIds: ReadonlySet<string>,
): CurriculumConcept | null {
  const mastery = new Map(topic.concepts.map((concept) => [concept.id, isMastered(concept, observations)]));
  const order = [...topic.progression.entryConcepts, ...topic.progression.preferredOrder.filter((id) => !topic.progression.entryConcepts.includes(id))];
  return order
    .map((id) => topic.concepts.find((concept) => concept.id === id))
    .filter((concept): concept is CurriculumConcept => concept !== undefined)
    .find((concept) => !mastery.get(concept.id) && concept.prerequisites.every((id) => mastery.get(id) === true) && conceptHasQuestions(topic, concept, facts, usedQuestionIds)) ?? null;
}

function selectAfterRating(
  topic: CurriculumTopic,
  facts: SketchFacts,
  concept: CurriculumConcept,
  currentQuestion: CurriculumQuestion,
  rating: TutorAnswerRating,
  observations: readonly Observation[],
  usedQuestionIds: ReadonlySet<string>,
  difficulty: TutorDifficulty,
): { concept: CurriculumConcept; question: CurriculumQuestion; scaffold?: CurriculumScaffold } | null {
  if (rating <= 2) {
    const scaffold = chooseScaffold(topic, concept.id, observations, usedQuestionIds);
    const scaffoldQuestion = scaffold ? topic.questions.find((question) => question.id === scaffold.nextQuestion) : undefined;
    if (scaffoldQuestion && questionApplies(scaffoldQuestion, facts) && !usedQuestionIds.has(scaffoldQuestion.id)) {
      const target = topic.concepts.find(({ id }) => id === scaffoldQuestion.concept);
      if (target) return { concept: target, question: scaffoldQuestion, scaffold };
    }
    return chooseQuestionInConcept(topic, facts, concept, currentQuestion, usedQuestionIds, difficulty);
  }

  const sameIndicator = topic.questions.find((question) => question.concept === concept.id && question.indicator === currentQuestion.indicator && questionApplies(question, facts) && !usedQuestionIds.has(question.id));
  if (rating === 3 && sameIndicator) return { concept, question: sameIndicator };

  if (rating >= 4 && !isMastered(concept, observations)) {
    const missing = concept.mastery.requiredIndicators.find((indicator) => !indicatorMastered(indicator, concept, observations));
    const missingQuestion = topic.questions.find((question) => question.concept === concept.id && question.indicator === missing && questionApplies(question, facts) && !usedQuestionIds.has(question.id));
    if (missingQuestion) return { concept, question: missingQuestion };
    const consolidationQuestion = topic.questions.find((question) => question.concept === concept.id && questionApplies(question, facts) && !usedQuestionIds.has(question.id));
    if (consolidationQuestion) return { concept, question: consolidationQuestion };
  }

  if (rating === 3) return chooseQuestionInConcept(topic, facts, concept, currentQuestion, usedQuestionIds, difficulty);
  return selectNextConcept(topic, facts, observations, usedQuestionIds)
    ? (() => {
      const nextConcept = selectNextConcept(topic, facts, observations, usedQuestionIds)!;
      const question = selectQuestion(topic, nextConcept, facts, usedQuestionIds, difficulty);
      return question ? { concept: nextConcept, question } : null;
    })()
    : null;
}

function chooseQuestionInConcept(
  topic: CurriculumTopic,
  facts: SketchFacts,
  concept: CurriculumConcept,
  currentQuestion: CurriculumQuestion,
  usedQuestionIds: ReadonlySet<string>,
  difficulty: TutorDifficulty,
): { concept: CurriculumConcept; question: CurriculumQuestion } | null {
  const question = selectQuestion(topic, concept, facts, usedQuestionIds, difficulty, currentQuestion.id);
  return question ? { concept, question } : null;
}

function selectQuestion(
  topic: CurriculumTopic,
  concept: CurriculumConcept,
  facts: SketchFacts,
  usedQuestionIds: ReadonlySet<string>,
  difficulty: TutorDifficulty,
  excludedId?: string,
): CurriculumQuestion | null {
  const candidates = topic.questions.filter((question) => question.concept === concept.id && questionApplies(question, facts) && !usedQuestionIds.has(question.id) && question.id !== excludedId);
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => difficultyDistance(left, difficulty) - difficultyDistance(right, difficulty) || left.id.localeCompare(right.id))[0] ?? null;
}

function difficultyDistance(question: CurriculumQuestion, difficulty: TutorDifficulty): number {
  const [min, max] = question.difficulty;
  if (difficulty < min) return min - difficulty;
  if (difficulty > max) return difficulty - max;
  return 0;
}

function questionApplies(question: CurriculumQuestion, facts: SketchFacts): boolean {
  return question.requires.every((requirement) => matchesFactRequirement(facts, requirement));
}

function conceptHasQuestions(topic: CurriculumTopic, concept: CurriculumConcept, facts: SketchFacts, usedQuestionIds: ReadonlySet<string>): boolean {
  return topic.questions.some((question) => question.concept === concept.id && questionApplies(question, facts) && !usedQuestionIds.has(question.id));
}

function chooseScaffold(
  topic: CurriculumTopic,
  conceptId: string,
  observations: readonly Observation[],
  usedQuestionIds: ReadonlySet<string>,
): CurriculumScaffold | undefined {
  const ownObservations = observations.filter((observation) => observation.conceptId === conceptId);
  let weakCount = 0;
  for (const observation of [...ownObservations].reverse()) {
    if (observation.rating > 2) break;
    weakCount += 1;
  }
  const level = Math.min(3, Math.max(1, weakCount));
  return [...topic.scaffolds]
    .filter((scaffold) => scaffold.forConcept === conceptId && !usedQuestionIds.has(scaffold.nextQuestion))
    .sort((left, right) => Math.abs(left.level - level) - Math.abs(right.level - level) || left.level - right.level)[0];
}

function indicatorMastered(indicatorId: string, concept: CurriculumConcept, observations: readonly Observation[]): boolean {
  return observations.some((observation) => observation.conceptId === concept.id && observation.indicatorId === indicatorId && observation.rating >= concept.mastery.successRatingAtLeast);
}

function isMastered(concept: CurriculumConcept, observations: readonly Observation[]): boolean {
  const own = observations.filter((observation) => observation.conceptId === concept.id);
  const successful = own.filter((observation) => observation.rating >= concept.mastery.successRatingAtLeast);
  const weakTrailing = [...own].reverse().findIndex((observation) => observation.rating > 2);
  const recentWeakCount = weakTrailing < 0 ? own.length : weakTrailing;
  return successful.length >= concept.mastery.minimumSuccessfulProbes
    && concept.mastery.requiredIndicators.every((indicator) => indicatorMastered(indicator, concept, observations))
    && new Set(successful.map((observation) => observation.kind)).size >= concept.mastery.minimumDistinctQuestionKinds
    && recentWeakCount <= concept.mastery.recentWeakAnswersAllowed;
}

export { buildPlan, collectObservations, isMastered, questionApplies, selectQuestion };

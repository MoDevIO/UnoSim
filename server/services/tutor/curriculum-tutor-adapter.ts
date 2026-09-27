import type { TutorDialogTurn, TutorDifficulty } from "@shared/tutor";
import {
  type DidacticContentRepository,
} from "./curriculum/content-repository";
import type { TutorCapability } from "../course-content/course-content-loader";
import type { ExampleTutorAnnotation } from "../course-content/embedded-tutor-annotation";
import {
  resolveEffectiveTutorStrategy,
  type EffectiveTutorStrategy,
  type StrategyResolution,
} from "./strategy/effective-tutor-strategy";
import {
  DefaultLearningPlanner,
  classifyTopic,
  collectObservations,
  type LearningPlanner,
  type Observation,
  type TopicClassification,
} from "./curriculum/learning-planner";
import { DefaultSketchFactExtractor, type SketchFactExtractor } from "./curriculum/sketch-facts";
import { DefaultTopicMatcher, type TopicMatcher } from "./curriculum/topic-matcher";
import type { TutorPlan, TutorPlanningContentContext, TutorPlanningExtension } from "./tutor-planning";
import type { TutorPlanningBlocked, TutorPlanningResult } from "./tutor-planning";
import {
  appendEvidence,
  createTutorProgressionState,
  deepeningCriteria,
  hasMetDeepeningCriteria,
  markTopicMastered,
  type DidacticPhase,
  type TutorProgressionState,
} from "./curriculum/progression-state";
import type { CurriculumQuestion, CurriculumTopic } from "./curriculum/curriculum-schema";
import type { TopicMatch } from "./curriculum/topic-matcher";

export interface CurriculumTutorAdapterDependencies {
  readonly courseContent?: CourseContentSnapshotProvider;
  readonly repository?: DidacticContentRepository;
  readonly factExtractor?: SketchFactExtractor;
  readonly topicMatcher?: TopicMatcher;
  readonly planner?: LearningPlanner;
}

export interface CourseContentSnapshotProvider {
  getSnapshot(): Promise<{
    readonly revision: string;
    readonly tutor?: TutorCapability;
    readonly exampleId?: string;
    readonly exampleTutorAnnotation?: ExampleTutorAnnotation;
    readonly progressionState?: TutorProgressionState;
  } | null>;
}

export class CurriculumTutorAdapter implements TutorPlanningExtension {
  private readonly courseContent?: CourseContentSnapshotProvider;
  private readonly repository?: DidacticContentRepository;
  private readonly factExtractor: SketchFactExtractor;
  private readonly topicMatcher: TopicMatcher;
  private readonly planner: LearningPlanner;

  constructor(deps: CurriculumTutorAdapterDependencies = {}) {
    this.courseContent = deps.courseContent;
    this.repository = deps.repository;
    this.factExtractor = deps.factExtractor ?? new DefaultSketchFactExtractor();
    this.topicMatcher = deps.topicMatcher ?? new DefaultTopicMatcher();
    this.planner = deps.planner ?? new DefaultLearningPlanner();
  }

  async resolveStrategy(input: { courseContent?: TutorPlanningContentContext }): Promise<StrategyResolution> {
    try {
      const snapshot = input.courseContent ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      return this.resolveSnapshotStrategy(snapshot);
    } catch {
      return resolveEffectiveTutorStrategy({});
    }
  }

  async planInitial(input: { code: string; history: readonly TutorDialogTurn[]; difficulty: TutorDifficulty; exampleId?: string; courseContent?: TutorPlanningContentContext }): Promise<TutorPlanningResult | null> {
    const context = await this.match(input.code, input.history, input.difficulty, input.courseContent);
    if (!context) return null;
    if (context.blocked) return context.blocked;
    const plan = this.planner.start(
      context.topic,
      context.revision,
      context.facts,
      input.history,
      input.difficulty,
      context.strategy.strategy,
      progressionOptions(context.topic, context.phase, context.state),
    );
    return plan ? normalizePlan(plan, context.strategy, context.state, context.phase, context.extensionTargetTopicId) : null;
  }

  async planFollowup(input: {
    code: string;
    history: readonly TutorDialogTurn[];
    currentQuestion: string;
    rating: Parameters<NonNullable<LearningPlanner["advance"]>>[5];
    difficulty: TutorDifficulty;
    exampleId?: string;
    courseContent?: TutorPlanningContentContext;
  }): Promise<TutorPlanningResult | null> {
    const context = await this.match(input.code, input.history, input.difficulty, input.courseContent);
    if (!context) return null;
    if (context.blocked) return context.blocked;
    const state = context.state;
    const current = findQuestion(context.topic, input.currentQuestion, input.history);
    if (current && state) {
      const observation = toObservation(current, input.rating);
      if (context.phase === "DEEPEN" || context.phase === "EXPAND") {
        appendEvidence(state, "postMasteryEvidence", context.topic.id, observation);
      } else {
        appendEvidence(state, "masteryEvidence", context.topic.id, observation);
      }
    }

    const refreshed = await this.match(input.code, input.history, input.difficulty, input.courseContent);
    if (!refreshed) return null;
    if (refreshed.blocked) return refreshed.blocked;
    const activeChanged = refreshed.topic.id !== context.topic.id;
    if (state && !activeChanged && context.phase === "LEARN") {
      const classification = classifyWithState(refreshed.topic, refreshed.facts, input.history, state, input.difficulty, refreshed.strategy.strategy);
      if (classification.status === "mastered") markTopicMastered(state, refreshed.topic.id);
      if (classification.status === "unresolved") return blockedResult(refreshed, state);
      if (classification.status === "mastered") {
        state.phase = "DEEPEN";
        state.retainedPhases[refreshed.topic.id] = "DEEPEN";
      }
    }
    const nextPhase = state?.phase ?? refreshed.phase;
    const planningHistory = activeChanged
      ? input.history
      : progressionHistory(refreshed.topic, input.history, state, input.currentQuestion);
    if (activeChanged || nextPhase !== context.phase) {
      const plan = this.planner.start(refreshed.topic, refreshed.revision, refreshed.facts, planningHistory, input.difficulty, refreshed.strategy.strategy, progressionOptions(refreshed.topic, nextPhase, state));
      return plan ? normalizePlan(plan, refreshed.strategy, state, nextPhase, refreshed.extensionTargetTopicId) : null;
    }
    if (nextPhase === "DEEPEN" && state && hasMetDeepeningCriteria(refreshed.topic, state.postMasteryEvidence[refreshed.topic.id] ?? [])) {
      state.phase = "EXPAND";
      state.retainedPhases[refreshed.topic.id] = "EXPAND";
      const plan = this.planner.start(refreshed.topic, refreshed.revision, refreshed.facts, planningHistory, input.difficulty, refreshed.strategy.strategy, progressionOptions(refreshed.topic, "EXPAND", state));
      return plan ? normalizePlan(plan, refreshed.strategy, state, "EXPAND", refreshed.extensionTargetTopicId) : null;
    }
    const plan = this.planner.advance(refreshed.topic, refreshed.revision, refreshed.facts, input.history, input.currentQuestion, input.rating, {
      difficulty: input.difficulty,
      strategy: refreshed.strategy.strategy,
      ...progressionOptions(refreshed.topic, nextPhase, state),
    });
    return plan ? normalizePlan(plan, refreshed.strategy, state, nextPhase, refreshed.extensionTargetTopicId) : null;
  }

  private async match(code: string, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty, supplied?: TutorPlanningContentContext) {
    try {
      const snapshot = supplied ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      if (snapshot) {
        return this.matchCourseContent(code, history, difficulty, snapshot);
      }
      if (!this.courseContent) {
        const legacy = this.repository ? await this.repository.getSnapshot() : null;
        if (!legacy) return null;
        const facts = this.factExtractor.extract(code);
        const match = this.topicMatcher.match(legacy.topics, facts)[0];
        if (!match) return null;
        return {
          revision: legacy.revision,
          facts,
          topic: match.topic,
          strategy: resolveEffectiveTutorStrategy({}),
          phase: "LEARN",
          state: createTutorProgressionState(legacy.revision),
        } satisfies AdapterContext;
      }
      return null;
    } catch {
      return null;
    }
  }

  private matchCourseContent(code: string, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty, snapshot: TutorPlanningContentContext): AdapterContext | null {
    if (snapshot.tutor?.status !== "valid" || snapshot.tutor.topics.length === 0) return null;
    const facts = this.factExtractor.extract(code);
    const matches = this.topicMatcher.match(snapshot.tutor.topics, facts);
    const annotation = snapshot.exampleTutorAnnotation;
    const orderedMatches = orderTopicMatches(matches, annotation);
    const state = snapshot.progressionState ?? createTutorProgressionState(snapshot.revision);
    const previousActiveTopicId = state.activeTopicId;
    const previousPhase = state.phase;
    const learnStrategy = this.resolveSnapshotStrategy(snapshot, annotation, "LEARN");
    const classifications = orderedMatches.map((match) => ({
      match,
      classification: classifyWithState(match.topic, facts, history, state, difficulty, learnStrategy.strategy),
    }));
    const firstProbeable = classifications.find(({ classification }) => classification.status === "probeable");
    const firstUnresolved = classifications.find(({ classification }) => classification.status === "unresolved");
    const active = state.activeTopicId ? classifications.find(({ match }) => match.topic.id === state.activeTopicId) : undefined;
    const selected = firstProbeable ?? firstUnresolved ?? active ?? classifications.find(({ classification }) => classification.status === "mastered");
    const match = selected?.match;
    if (!match) return null;
    const classification = selected?.classification;
    const phase = phaseForTopic(state, match.topic.id, classification?.status);
    state.activeTopicId = match.topic.id;
    state.phase = phase;
    state.progressionBlockedReason = undefined;
    const strategy = this.resolveSnapshotStrategy(snapshot, annotation, phase);
    const previousTopic = previousActiveTopicId
      ? snapshot.tutor.topics.find(({ id }) => id === previousActiveTopicId)
      : undefined;
    const extensionTargetTopicId = previousActiveTopicId && previousPhase === "EXPAND" && previousActiveTopicId !== match.topic.id
      && previousTopic?.schemaVersion === 2
      && previousTopic.extensions?.some((extension) => extension.topic === match.topic.id)
      ? match.topic.id
      : undefined;
    if (classification?.status === "unresolved") return { blocked: blockedResult({ revision: snapshot.revision, topic: match.topic, strategy, phase, state }, state), revision: snapshot.revision, facts, topic: match.topic, strategy, phase, state, extensionTargetTopicId };
    return {
      revision: snapshot.revision,
      facts,
      topic: match.topic,
      strategy,
      phase,
      state,
      ...(extensionTargetTopicId ? { extensionTargetTopicId } : {}),
    };
  }

  private resolveSnapshotStrategy(
    snapshot: TutorPlanningContentContext | null,
    knownAnnotation?: ExampleTutorAnnotation,
    phase: DidacticPhase = "LEARN",
  ): StrategyResolution {
    if (snapshot?.tutor?.status !== "valid") return resolveEffectiveTutorStrategy({});
    const tutor = snapshot.tutor;
    const annotation = knownAnnotation ?? snapshot.exampleTutorAnnotation;
    const repositoryDefault = tutor.manifest.defaultStrategy === undefined
      ? undefined
      : tutor.strategies.find(({ id }) => id === tutor.manifest.defaultStrategy);
    const perExample = annotation?.strategy === undefined
      ? undefined
      : tutor.strategies.find(({ id }) => id === annotation.strategy);
    const phaseStrategyId = phase === "LEARN" || tutor.manifest.schemaVersion !== 2
      ? undefined
      : tutor.manifest.phaseStrategies?.[phase.toLowerCase() as "deepen" | "expand"];
    const phaseStrategy = phaseStrategyId === undefined
      ? undefined
      : tutor.strategies.find(({ id }) => id === phaseStrategyId);
    return resolveEffectiveTutorStrategy({ perExample, repositoryDefault: phaseStrategy ?? repositoryDefault });
  }
}

function normalizePlan(plan: Awaited<ReturnType<LearningPlanner["start"]>>, strategy = resolveEffectiveTutorStrategy({}), state?: TutorProgressionState, phase: DidacticPhase = "LEARN", extensionTargetTopicId?: string): TutorPlan {
  if (!plan) throw new Error("Cannot normalize an empty tutor plan");
  return {
    ...plan.brief,
    ...(plan.brief.scaffold ? { scaffold: { ...plan.brief.scaffold } } : {}),
    contentRevision: plan.contentRevision,
    strategyId: strategy.strategy.id,
    strategySource: strategy.source === "built-in" ? "built-in" : "repository",
    learningPhase: phase,
    ...(state?.activeTopicId ? { activeTopicId: state.activeTopicId } : {}),
    ...(state ? { masteredTopicIds: [...state.masteredTopicIds] } : {}),
    ...(state?.progressionBlockedReason ? { progressionBlockedReason: state.progressionBlockedReason } : {}),
    ...(extensionTargetTopicId ? { extensionTargetTopicId } : {}),
  };
}

type AdapterContext = {
  readonly revision: string;
  readonly facts: ReturnType<SketchFactExtractor["extract"]>;
  readonly topic: CurriculumTopic;
  readonly strategy: StrategyResolution;
  readonly phase: DidacticPhase;
  readonly state: TutorProgressionState;
  readonly extensionTargetTopicId?: string;
  readonly blocked?: TutorPlanningBlocked;
};

function orderTopicMatches(matches: readonly TopicMatch[], annotation?: ExampleTutorAnnotation): readonly TopicMatch[] {
  const byId = new Map(matches.map((match) => [match.topic.id, match]));
  const boundIds = [
    ...(annotation?.primaryTopic ? [annotation.primaryTopic] : []),
    ...(annotation?.topics ?? []),
  ];
  const bound = boundIds.map((id) => byId.get(id)).filter((match): match is TopicMatch => match !== undefined);
  const boundSet = new Set(bound.map(({ topic }) => topic.id));
  return [...bound, ...matches.filter(({ topic }) => !boundSet.has(topic.id))];
}

function phaseForTopic(state: TutorProgressionState, topicId: string, classification?: string): DidacticPhase {
  if (classification === "mastered" || state.masteredTopicIds.includes(topicId)) return state.retainedPhases[topicId] ?? "DEEPEN";
  return "LEARN";
}

function progressionOptions(topic: CurriculumTopic, phase: DidacticPhase, state: TutorProgressionState) {
  if (phase === "LEARN") return { phase } as const;
  const criteria = deepeningCriteria(topic);
  const existingQuestionKinds = (state.postMasteryEvidence[topic.id] ?? []).map(({ kind }) => kind);
  return {
    phase,
    preferredQuestionKinds: criteria.requiredQuestionKinds,
    existingQuestionKinds,
  } as const;
}

function collectUsedQuestionIds(topic: CurriculumTopic, history: readonly TutorDialogTurn[], state: TutorProgressionState): Set<string> {
  const byText = new Map(topic.questions.flatMap((question) => question.text ? [[question.text, question.id] as const] : []));
  const historyIds = history.map((turn) => turn.questionId ?? byText.get(turn.question)).filter((id): id is string => id !== undefined);
  return new Set([...historyIds, ...(state.masteryEvidence[topic.id] ?? []).map(({ questionId }) => questionId)]);
}

function progressionHistory(
  topic: CurriculumTopic,
  history: readonly TutorDialogTurn[],
  state: TutorProgressionState,
  currentQuestion: string,
): readonly TutorDialogTurn[] {
  const byId = new Map(topic.questions.map((question) => [question.id, question.text ?? question.template ?? question.id]));
  const postMasteryTurns = (state.postMasteryEvidence[topic.id] ?? []).map(({ questionId }) => ({
    question: byId.get(questionId) ?? questionId,
    questionId,
    answer: "",
    responseStyle: "normal" as const,
  }));
  return [...history, ...postMasteryTurns, { question: currentQuestion, answer: "", responseStyle: "normal" as const }];
}

function classifyWithState(
  topic: CurriculumTopic,
  facts: ReturnType<SketchFactExtractor["extract"]>,
  history: readonly TutorDialogTurn[],
  state: TutorProgressionState,
  difficulty: TutorDifficulty,
  strategy: EffectiveTutorStrategy,
) {
  const stored = state.masteryEvidence[topic.id] ?? [];
  const storedQuestionIds = new Set(stored.map(({ questionId }) => questionId));
  const observations = [...stored, ...collectObservations(topic, history).filter(({ questionId }) => !storedQuestionIds.has(questionId))];
  const classification = classifyTopic(topic, facts, observations, collectUsedQuestionIds(topic, history, state), difficulty, strategy);
  if (state.masteredTopicIds.includes(topic.id) && classification.status !== "inapplicable") {
    return { status: "mastered", masteryDomain: classification.masteryDomain } satisfies TopicClassification;
  }
  return classification;
}

function blockedResult(context: Pick<AdapterContext, "revision" | "topic" | "strategy" | "phase" | "state">, state: TutorProgressionState): TutorPlanningBlocked {
  state.phase = "LEARN";
  state.progressionBlockedReason = "content-exhausted";
  return {
    kind: "blocked",
    progressionBlockedReason: "content-exhausted",
    contentRevision: context.revision,
    learningPhase: "LEARN",
    activeTopicId: context.topic.id,
    masteredTopicIds: [...state.masteredTopicIds],
    strategyId: context.strategy.strategy.id,
    strategySource: context.strategy.source === "built-in" ? "built-in" : "repository",
  };
}

function findQuestion(topic: CurriculumTopic, currentQuestion: string, history: readonly TutorDialogTurn[]): CurriculumQuestion | null {
  const questionId = history.find((turn) => turn.question === currentQuestion)?.questionId;
  return topic.questions.find(({ id }) => id === questionId) ?? topic.questions.find(({ text }) => text === currentQuestion) ?? null;
}

function toObservation(current: CurriculumQuestion, rating: Parameters<NonNullable<LearningPlanner["advance"]>>[5]): Observation {
  return {
    questionId: current.id,
    conceptId: current.concept,
    indicatorId: current.indicator,
    kind: current.kind,
    rating,
  };
}

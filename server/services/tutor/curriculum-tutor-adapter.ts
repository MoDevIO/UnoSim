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
  buildPlan,
  classifyTopic,
  collectObservations,
  type LearningPlanner,
  type Observation,
  type TopicClassification,
} from "./curriculum/learning-planner";
import { DefaultSketchFactExtractor, type SketchFactExtractor } from "./curriculum/sketch-facts";
import { DefaultTopicMatcher, type TopicMatch, type TopicMatcher } from "./curriculum/topic-matcher";
import type {
  TutorPlan,
  TutorPlanningBlocked,
  TutorPlanningContentContext,
  TutorPlanningExtension,
  TutorPlanningResult,
  TutorExpansionBrief,
} from "./tutor-planning";
import {
  appendEvidence,
  cloneTutorProgressionState,
  createTutorProgressionState,
  deepeningCriteria,
  hasMetDeepeningCriteria,
  markExpansionTargetUsed,
  markTopicMastered,
  resetTutorProgressionState,
  type DidacticPhase,
  type TutorProgressionState,
} from "./curriculum/progression-state";
import type { CurriculumQuestion, CurriculumTopic } from "./curriculum/curriculum-schema";

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

type TutorFollowupInput = {
  readonly code: string;
  readonly history: readonly TutorDialogTurn[];
  readonly currentQuestion: string;
  readonly rating: Parameters<NonNullable<LearningPlanner["advance"]>>[5];
  readonly difficulty: TutorDifficulty;
  readonly exampleId?: string;
  readonly courseContent?: TutorPlanningContentContext;
};

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

  async resolveStrategy(input: { code?: string; courseContent?: TutorPlanningContentContext }): Promise<StrategyResolution> {
    try {
      const snapshot = input.courseContent ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      const phase = this.resolveActivePhase(snapshot, input.code);
      return this.resolveSnapshotStrategy(snapshot, undefined, phase);
    } catch {
      return resolveEffectiveTutorStrategy({});
    }
  }

  async planInitial(input: { code: string; history: readonly TutorDialogTurn[]; difficulty: TutorDifficulty; exampleId?: string; courseContent?: TutorPlanningContentContext }): Promise<TutorPlanningResult | null> {
    const context = await this.match(input.code, input.history, input.difficulty, input.courseContent, input.exampleId);
    if (!context) return null;
    if (context.blocked) return context.blocked;
    return this.startPlan(context, sessionHistory(context.topic, input.history, context.state), input.difficulty, context.phase);
  }

  async planAnswered(input: Omit<TutorFollowupInput, "rating">): Promise<TutorPlanningResult | null> {
    const snapshot = input.courseContent ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
    // Read-only: match against a copy so that resolving the context cannot change the session
    // state; a question that cannot be resolved yields no context instead of a new plan.
    const readOnly = snapshot?.progressionState
      ? { ...snapshot, progressionState: cloneTutorProgressionState(snapshot.progressionState) }
      : snapshot ?? undefined;
    const context = await this.match(input.code, input.history, input.difficulty, readOnly, input.exampleId);
    if (!context) return null;
    if (context.blocked) return context.blocked;
    return answeredQuestionPlan(context, input.currentQuestion, input.history);
  }

  async planFollowup(input: TutorFollowupInput): Promise<TutorPlanningResult | null> {
    const context = await this.match(input.code, input.history, input.difficulty, input.courseContent, input.exampleId);
    if (!context) return null;
    if (context.blocked) return context.blocked;
    // The session view of the answered turn's past, taken before the answer is recorded: the
    // planner adds the current answer itself and must not count it twice.
    const answeredHistory = sessionHistory(context.topic, input.history, context.state);
    recordFollowupObservation(context, input);
    const stateUpdate = updateStateAfterFollowup(context, input);
    const refreshed = await this.match(input.code, input.history, input.difficulty, input.courseContent, input.exampleId);
    if (!refreshed) return null;
    if (refreshed.blocked) return refreshed.blocked;
    return this.continueFollowup(context, refreshed, input, stateUpdate, answeredHistory);
  }

  private continueFollowup(
    context: AdapterContext,
    refreshed: AdapterContext,
    input: TutorFollowupInput,
    stateUpdate: FollowupStateUpdate,
    answeredHistory: readonly TutorDialogTurn[],
  ): TutorPlanningResult | null {
    const activeChanged = refreshed.topic.id !== context.topic.id;
    if (!activeChanged && stateUpdate.status === "unresolved") return blockedResult(refreshed, context.state);
    const nextPhase = refreshed.phase;
    if (activeChanged) return this.startPlan(refreshed, sessionHistory(refreshed.topic, input.history, context.state), input.difficulty, nextPhase);
    const planningHistory = [...answeredHistory, answeredTurn(input.currentQuestion)];
    // The answer is evaluated by the strategy that produced the current turn.
    // A phase transition is committed to session state now, but its first plan
    // and strategy are exposed at the next request boundary.
    if (nextPhase !== context.phase) return this.currentTurnPlan(context, planningHistory, input.difficulty);
    if (nextPhase === "DEEPEN" && hasMetDeepeningCriteria(refreshed.topic, context.state.postMasteryEvidence[refreshed.topic.id] ?? [])) {
      context.state.phase = "EXPAND";
      context.state.retainedPhases[refreshed.topic.id] = "EXPAND";
      return this.currentTurnPlan(context, planningHistory, input.difficulty);
    }
    return this.advancePlan(refreshed, input, answeredHistory);
  }

  private startPlan(context: AdapterContext, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty, phase: DidacticPhase): TutorPlanningResult | null {
    if (phase === "EXPAND" && context.expansionBrief) {
      markExpansionTargetUsed(context.state, context.expansionBrief.sourceTopicId, context.expansionBrief.targetTopicId);
      return buildExpansionPlan(context, phase, context.expansionBrief);
    }
    const plan = this.planner.start(context.topic, context.revision, context.facts, history, difficulty, context.strategy.strategy, progressionOptions(context.topic, phase, context.state));
    if (plan) return normalizePlan(plan, context.strategy, context.state, phase, context.extensionTargetTopicId, context.expansionBrief);
    return phase === "LEARN" ? null : exhaustionResult(context, phase);
  }

  private currentTurnPlan(context: AdapterContext, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty): TutorPlanningResult {
    return this.startPlan(context, history, difficulty, context.phase)
      ?? transitionResult(context);
  }

  private advancePlan(context: AdapterContext, input: TutorFollowupInput, answeredHistory: readonly TutorDialogTurn[]): TutorPlanningResult | null {
    const answeredPhase = context.state.phase ?? context.phase;
    if (answeredPhase === "EXPAND") {
      // Every EXPAND step is planned as at phase start: an unused extension first, then an unused
      // post-mastery Topic question, and content-exhausted only when neither exists (R-EXP-2). This
      // holds whatever was answered: the planner cannot advance from a generated extension or from
      // a question it cannot resolve, and advancing from a Topic question would never offer an
      // extension.
      return this.startPlan(context, [...answeredHistory, answeredTurn(input.currentQuestion)], input.difficulty, answeredPhase);
    }
    const plan = this.planner.advance(context.topic, context.revision, context.facts, answeredHistory, input.currentQuestion, input.rating, {
      difficulty: input.difficulty,
      strategy: context.strategy.strategy,
      ...progressionOptions(context.topic, context.state.phase ?? context.phase, context.state),
    });
    const phase = context.state.phase ?? context.phase;
    if (plan) return normalizePlan(plan, context.strategy, context.state, phase, context.extensionTargetTopicId, context.expansionBrief);
    return phase === "LEARN" ? null : exhaustionResult(context, phase);
  }

  private async match(code: string, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty, supplied?: TutorPlanningContentContext, exampleId?: string) {
    try {
      const snapshot = supplied ?? (this.courseContent ? await this.courseContent.getSnapshot() : null);
      if (snapshot) {
        return this.matchCourseContent(code, history, difficulty, snapshot, exampleId);
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

  private matchCourseContent(code: string, history: readonly TutorDialogTurn[], difficulty: TutorDifficulty, snapshot: TutorPlanningContentContext, requestedExampleId?: string): AdapterContext | null {
    if (snapshot.tutor?.status !== "valid" || snapshot.tutor.topics.length === 0) return null;
    const facts = this.factExtractor.extract(code);
    const matches = this.topicMatcher.match(snapshot.tutor.topics, facts);
    const exampleContextId = snapshot.exampleId ?? requestedExampleId;
    const annotation = exampleContextId === undefined ? undefined : snapshot.exampleTutorAnnotation;
    const orderedMatches = orderTopicMatches(matches, annotation);
    const state = snapshot.progressionState ?? createTutorProgressionState(snapshot.revision);
    if (state.revision !== snapshot.revision) resetTutorProgressionState(state, snapshot.revision);
    const learnStrategy = this.resolveSnapshotStrategy(snapshot, annotation, "LEARN");
    const classifications = classifyMatches(orderedMatches, facts, history, state, difficulty, learnStrategy.strategy);
    const selected = selectProgressionMatch(classifications, state);
    const match = selected?.match;
    if (!match) return null;
    const classification = selected?.classification;
    const phase = phaseForTopic(state, match.topic.id, classification?.status);
    const previousActiveTopicId = state.activeTopicId;
    const previousPhase = state.phase ?? "LEARN";
    state.activeTopicId = match.topic.id;
    state.phase = phase;
    state.progressionBlockedReason = undefined;
    const strategy = this.resolveSnapshotStrategy(snapshot, annotation, phase);
    const extensionTargetTopicId = resolveExtensionTarget(snapshot.tutor.topics, previousActiveTopicId, previousPhase, match.topic.id);
    const expansionBrief = resolveExpansionBrief(snapshot.tutor.topics, match.topic, phase, state);
    const context = {
      revision: snapshot.revision,
      facts,
      topic: match.topic,
      strategy,
      phase,
      state,
      ...(extensionTargetTopicId ? { extensionTargetTopicId } : {}),
      ...(expansionBrief ? { expansionBrief } : {}),
    };
    return classification?.status === "unresolved"
      ? { ...context, blocked: blockedResult(context, state) }
      : context;
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

  private resolveActivePhase(snapshot: TutorPlanningContentContext | null, code?: string): DidacticPhase {
    const state = snapshot?.progressionState;
    if (!snapshot || !code || !state?.activeTopicId || !state.phase || state.phase === "LEARN") return "LEARN";
    if (state.revision !== snapshot.revision || snapshot.tutor?.status !== "valid") return "LEARN";
    const facts = this.factExtractor.extract(code);
    return this.topicMatcher.match(snapshot.tutor.topics, facts).some(({ topic }) => topic.id === state.activeTopicId)
      ? state.phase
      : "LEARN";
  }
}

type ClassifiedTopicMatch = {
  readonly match: TopicMatch;
  readonly classification: TopicClassification;
};

function classifyMatches(
  matches: readonly TopicMatch[],
  facts: ReturnType<SketchFactExtractor["extract"]>,
  history: readonly TutorDialogTurn[],
  state: TutorProgressionState,
  difficulty: TutorDifficulty,
  strategy: EffectiveTutorStrategy,
): readonly ClassifiedTopicMatch[] {
  return matches.map((match) => ({
    match,
    classification: classifyWithState(match.topic, facts, history, state, difficulty, strategy),
  }));
}

function selectProgressionMatch(
  classifications: readonly ClassifiedTopicMatch[],
  state: TutorProgressionState,
): ClassifiedTopicMatch | undefined {
  return classifications.find(({ classification }) => classification.status === "probeable")
    ?? classifications.find(({ classification }) => classification.status === "unresolved")
    ?? (state.activeTopicId ? classifications.find(({ match }) => match.topic.id === state.activeTopicId) : undefined)
    ?? classifications.find(({ classification }) => classification.status === "mastered");
}

function resolveExtensionTarget(
  topics: readonly CurriculumTopic[],
  previousTopicId: string | undefined,
  previousPhase: DidacticPhase,
  nextTopicId: string,
): string | undefined {
  if (!previousTopicId || previousPhase !== "EXPAND" || previousTopicId === nextTopicId) return undefined;
  const previousTopic = topics.find(({ id }) => id === previousTopicId);
  return previousTopic?.schemaVersion === 2 && previousTopic.extensions?.some(({ topic }) => topic === nextTopicId)
    ? nextTopicId
    : undefined;
}

function resolveExpansionBrief(
  topics: readonly CurriculumTopic[],
  topic: CurriculumTopic,
  phase: DidacticPhase,
  state: TutorProgressionState,
): TutorExpansionBrief | undefined {
  if (phase !== "EXPAND" || topic.schemaVersion !== 2 || !topic.extensions) return undefined;
  const usedTargets = new Set(state.usedExpansionTargetTopicIds[topic.id] ?? []);
  const extension = topic.extensions.find(({ topic: targetTopicId }) =>
    topics.some(({ id }) => id === targetTopicId) && !usedTargets.has(targetTopicId),
  );
  return extension
    ? { sourceTopicId: topic.id, targetTopicId: extension.topic, objective: extension.objective }
    : undefined;
}

function recordFollowupObservation(context: AdapterContext, input: TutorFollowupInput): void {
  const expansionTargetId = answeredExpansionTarget(context.topic, context.state, input.currentQuestion);
  if (expansionTargetId) {
    const id = expansionQuestionId(expansionTargetId);
    appendEvidence(context.state, "postMasteryEvidence", context.topic.id, {
      questionId: id,
      conceptId: id,
      indicatorId: EXPANSION_INDICATOR_ID,
      kind: "transfer",
      rating: input.rating,
    });
    return;
  }
  const current = findQuestion(context.topic, input.currentQuestion, input.history);
  if (!current) return;
  const evidenceKey = context.phase === "DEEPEN" || context.phase === "EXPAND"
    ? "postMasteryEvidence"
    : "masteryEvidence";
  appendEvidence(context.state, evidenceKey, context.topic.id, toObservation(current, input.rating));
}

type FollowupStateUpdate = {
  readonly status: TopicClassification["status"];
};

function updateStateAfterFollowup(context: AdapterContext, input: TutorFollowupInput): FollowupStateUpdate {
  if (context.phase !== "LEARN") return { status: "mastered" };
  const classification = classifyWithState(
    context.topic,
    context.facts,
    input.history,
    context.state,
    input.difficulty,
    context.strategy.strategy,
  );
  if (classification.status !== "mastered") return { status: classification.status };
  markTopicMastered(context.state, context.topic.id);
  context.state.phase = "DEEPEN";
  context.state.retainedPhases[context.topic.id] = "DEEPEN";
  return { status: classification.status };
}

function normalizePlan(plan: Awaited<ReturnType<LearningPlanner["start"]>>, strategy = resolveEffectiveTutorStrategy({}), state?: TutorProgressionState, phase: DidacticPhase = "LEARN", extensionTargetTopicId?: string, expansionBrief?: TutorExpansionBrief): TutorPlan {
  if (!plan) throw new Error("Cannot normalize an empty tutor plan");
  return {
    ...plan.brief,
    ...(plan.brief.scaffold ? { scaffold: { ...plan.brief.scaffold } } : {}),
    contentRevision: plan.contentRevision,
    strategyId: strategy.strategy.id,
    strategySource: strategy.source === "built-in" ? "built-in" : "repository",
    effectiveStrategy: strategy.strategy,
    learningPhase: phase,
    ...(state?.activeTopicId ? { activeTopicId: state.activeTopicId } : {}),
    ...(state ? { masteredTopicIds: [...state.masteredTopicIds] } : {}),
    ...(state?.progressionBlockedReason ? { progressionBlockedReason: state.progressionBlockedReason } : {}),
    ...(extensionTargetTopicId ? { extensionTargetTopicId } : {}),
    ...(expansionBrief ? { expansionBrief } : {}),
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
  readonly expansionBrief?: TutorExpansionBrief;
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

/**
 * The Topic's turns of the whole Tutor session, as the planner and the Topic classification see
 * them. The browser sends only the last INPUT_LIMITS.tutor.maxHistoryEntries dialog turns, while
 * the progression state keeps every answered planned question of the session as evidence. A
 * question that has left the dialog window is therefore restored from the evidence: it stays used
 * (strict repetition never reuses a Question ID, TutorQuality SSOT §3), and its LEARN rating keeps
 * counting for Concept mastery. Stored evidence wins over a dialog turn for the same question;
 * post-mastery evidence marks questions as used without counting toward LEARN mastery.
 */
function sessionHistory(
  topic: CurriculumTopic,
  history: readonly TutorDialogTurn[],
  state: TutorProgressionState,
): TutorDialogTurn[] {
  const byText = new Map(topic.questions.flatMap((question) => question.text ? [[question.text, question.id] as const] : []));
  const textById = new Map(topic.questions.map((question) => [question.id, question.text ?? question.template ?? question.id]));
  const mastery = state.masteryEvidence[topic.id] ?? [];
  const storedRatingIds = new Set(mastery.map(({ questionId }) => questionId));
  const evidenceTurns = [
    ...mastery.map((observation) => ({ observation, rated: true })),
    ...(state.postMasteryEvidence[topic.id] ?? []).map((observation) => ({ observation, rated: false })),
  ].map(({ observation, rated }): TutorDialogTurn => ({
    question: textById.get(observation.questionId) ?? observation.questionId,
    questionId: observation.questionId,
    answer: "",
    responseStyle: "normal",
    ...(rated ? { answerRating: observation.rating } : {}),
  }));
  const dialogTurns = history.map((turn) => {
    const questionId = turn.questionId ?? byText.get(turn.question);
    if (questionId === undefined || !storedRatingIds.has(questionId)) return turn;
    const { answerRating: _storedInstead, ...unrated } = turn;
    return { ...unrated, questionId };
  });
  return [...evidenceTurns, ...dialogTurns];
}

/** The question being answered, as a used turn without a rating of its own. */
function answeredTurn(currentQuestion: string): TutorDialogTurn {
  return { question: currentQuestion, answer: "", responseStyle: "normal" };
}

function classifyWithState(
  topic: CurriculumTopic,
  facts: ReturnType<SketchFactExtractor["extract"]>,
  history: readonly TutorDialogTurn[],
  state: TutorProgressionState,
  difficulty: TutorDifficulty,
  strategy: EffectiveTutorStrategy,
) {
  const session = sessionHistory(topic, history, state);
  const usedQuestionIds = new Set(session.flatMap(({ questionId }) => questionId ? [questionId] : []));
  const classification = classifyTopic(topic, facts, collectObservations(topic, session), usedQuestionIds, difficulty, strategy);
  if (state.masteredTopicIds.includes(topic.id) && classification.status !== "inapplicable") {
    return { status: "mastered", masteryDomain: classification.masteryDomain } satisfies TopicClassification;
  }
  return classification;
}

const EXPANSION_INDICATOR_ID = "expansion";

function expansionQuestionId(targetTopicId: string): string {
  return `expand-${targetTopicId.slice(0, 56)}`;
}

function expansionQuestionText(objective: string): string {
  return `Welche kleine, direkt am aktuellen Sketch prüfbare Erweiterung würdest du als Nächstes selbst umsetzen, um dieses Lernziel zu bearbeiten: „${objective}“, und woran würdest du ihre Wirkung erkennen?`;
}

// The dialog request carries only the text of the answered question, not its ID.
// A generated extension question is therefore recognized by the extension targets
// the application already recorded as delivered for this Topic; the text is built
// by the same function that generated it.
function answeredExpansionTarget(topic: CurriculumTopic, state: TutorProgressionState, currentQuestion: string): string | undefined {
  if (topic.schemaVersion !== 2 || !topic.extensions) return undefined;
  const delivered = new Set(state.usedExpansionTargetTopicIds[topic.id] ?? []);
  return topic.extensions.find(({ topic: targetTopicId, objective }) =>
    delivered.has(targetTopicId) && expansionQuestionText(objective) === currentQuestion,
  )?.topic;
}

// The plan of the question being answered, resolved by identity: a generated extension the
// application delivered for this Topic, or a Topic question. Reserves nothing in the state.
function answeredQuestionPlan(context: AdapterContext, currentQuestion: string, history: readonly TutorDialogTurn[]): TutorPlan | null {
  const expansionTargetId = answeredExpansionTarget(context.topic, context.state, currentQuestion);
  const extension = expansionTargetId && context.topic.schemaVersion === 2
    ? context.topic.extensions?.find(({ topic }) => topic === expansionTargetId)
    : undefined;
  if (extension) {
    return buildExpansionPlan(context, context.phase, { sourceTopicId: context.topic.id, targetTopicId: extension.topic, objective: extension.objective });
  }
  const question = findQuestion(context.topic, currentQuestion, history);
  const concept = question ? context.topic.concepts.find(({ id }) => id === question.concept) : undefined;
  if (!question || !concept) return null;
  return normalizePlan(buildPlan(context.topic, context.revision, concept, question), context.strategy, context.state, context.phase, context.extensionTargetTopicId);
}

function buildExpansionPlan(context: AdapterContext, phase: DidacticPhase, expansionBrief: TutorExpansionBrief): TutorPlan {
  const questionId = expansionQuestionId(expansionBrief.targetTopicId);
  return {
    topicId: context.topic.id,
    topicTitle: context.topic.title,
    conceptId: questionId,
    conceptTitle: "Eigene Erweiterung",
    objective: expansionBrief.objective,
    questionId,
    questionKind: "transfer",
    indicatorId: EXPANSION_INDICATOR_ID,
    indicator: expansionBrief.objective,
    question: expansionQuestionText(expansionBrief.objective),
    misconceptions: [],
    contentRevision: context.revision,
    strategyId: context.strategy.strategy.id,
    strategySource: context.strategy.source === "built-in" ? "built-in" : "repository",
    effectiveStrategy: context.strategy.strategy,
    learningPhase: phase,
    activeTopicId: context.state.activeTopicId,
    masteredTopicIds: [...context.state.masteredTopicIds],
    expansionBrief,
  };
}

type PlanningContext = Pick<AdapterContext, "revision" | "topic" | "strategy" | "phase" | "state">;

function exhaustionResult(context: PlanningContext, phase: DidacticPhase): TutorPlanningBlocked {
  context.state.phase = phase;
  context.state.progressionBlockedReason = "content-exhausted";
  return {
    kind: "blocked",
    progressionBlockedReason: "content-exhausted",
    contentRevision: context.revision,
    learningPhase: phase,
    activeTopicId: context.topic.id,
    masteredTopicIds: [...context.state.masteredTopicIds],
    strategyId: context.strategy.strategy.id,
    strategySource: context.strategy.source === "built-in" ? "built-in" : "repository",
    effectiveStrategy: context.strategy.strategy,
  };
}

function transitionResult(context: PlanningContext): import("./tutor-planning").TutorPlanningTransition {
  return {
    kind: "transition",
    contentRevision: context.revision,
    learningPhase: context.phase,
    activeTopicId: context.topic.id,
    masteredTopicIds: [...context.state.masteredTopicIds],
    strategyId: context.strategy.strategy.id,
    strategySource: context.strategy.source === "built-in" ? "built-in" : "repository",
    effectiveStrategy: context.strategy.strategy,
  };
}

function blockedResult(context: PlanningContext, state: TutorProgressionState): TutorPlanningBlocked {
  state.phase = context.phase;
  state.progressionBlockedReason = "content-exhausted";
  return {
    kind: "blocked",
    progressionBlockedReason: "content-exhausted",
    contentRevision: context.revision,
    learningPhase: context.phase,
    activeTopicId: context.topic.id,
    masteredTopicIds: [...state.masteredTopicIds],
    strategyId: context.strategy.strategy.id,
    strategySource: context.strategy.source === "built-in" ? "built-in" : "repository",
    effectiveStrategy: context.strategy.strategy,
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

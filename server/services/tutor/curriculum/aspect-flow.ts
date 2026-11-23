import type { TutorAnswerRating } from "@shared/tutor";
import { namesAssignmentSite } from "../assignment-prompt";
import type { StrategyResolution } from "../strategy/effective-tutor-strategy";
import type { TutorAspectChoice, TutorPlan, TutorPlanningBlocked } from "../tutor-planning";
import { activityErrorNote, drawableSiteCodes } from "../uml/excerpt";
import { detectAspects, type DetectedAspect } from "./aspect-detector";
import { leaveOpen, openStep, planNext, recordAnswer, syncSketch, type AspectStep } from "./aspect-planner";
import { ASPECT_LEVEL_NAMES, type AspectDefinition, type AspectLevel } from "./aspect-schema";
import { competenceOf, createAspectSessionState, type AspectSessionState } from "./competence-state";
import type { TutorProgressionState } from "./progression-state";

/**
 * The aspect flow as the planning adapter uses it: it turns the planner's steps into `TutorPlan`s and
 * keeps the aspect state inside the session's progression state. Every function changes the state it is
 * given; a caller that must not change the session passes a copy.
 */
export interface AspectFlowInput {
  readonly code: string;
  readonly state: TutorProgressionState;
  readonly definitions: readonly AspectDefinition[];
  readonly revision: string;
  readonly strategy: StrategyResolution;
  /** The teacher's aspects of the Example, in their order; they come before the rest. */
  readonly preferredAspects?: readonly string[];
  /** The request can show a diagram the application builds; without it no find-the-error question is asked. */
  readonly diagrams?: boolean;
}

const QUESTION_KIND: Readonly<Record<AspectLevel, TutorPlan["questionKind"]>> = { 1: "recall", 2: "concept", 3: "prediction", 4: "transfer" };
const ASPECT_TOPIC_PREFIX = "aspect-";

/** The aspect that asks about activity diagrams the application draws from the sketch. */
const DIAGRAMS_ASPECT = "diagrams";

/** The diagram aspect keeps the statements that can be drawn, and exists only where a diagram can be shown. */
function withDrawableSites(input: AspectFlowInput, aspects: readonly DetectedAspect[]): DetectedAspect[] {
  return aspects.flatMap((aspect) => {
    if (aspect.id !== DIAGRAMS_ASPECT) return [aspect];
    if (!input.diagrams) return [];
    const drawable = drawableSiteCodes(input.code, aspect.sites.map(({ code }) => code));
    const sites = aspect.sites.filter(({ code }) => drawable.has(code));
    return sites.length > 0 ? [{ ...aspect, sites }] : [];
  });
}

function prepare(input: AspectFlowInput): { session: AspectSessionState; aspects: DetectedAspect[] } {
  const session = input.state.aspects ?? createAspectSessionState();
  input.state.aspects = session;
  const detected = detectAspects(input.code);
  syncSketch(session, detected);
  return { session, aspects: withDrawableSites(input, detected) };
}

/**
 * The aspects to plan from. The diagram aspect asks about statements other aspects ask about too, so it is
 * planned only when the learner chose it, the teacher listed it or one of its questions is in progress.
 */
function plannable(input: AspectFlowInput, session: AspectSessionState, aspects: readonly DetectedAspect[]): readonly DetectedAspect[] {
  const wanted = [session.focusAspectId, session.activeAspectId, ...(input.preferredAspects ?? [])].includes(DIAGRAMS_ASPECT);
  return wanted ? aspects : aspects.filter(({ id }) => id !== DIAGRAMS_ASPECT);
}

function strategyFields({ strategy }: AspectFlowInput) {
  return {
    strategyId: strategy.strategy.id,
    strategySource: strategy.source === "built-in" ? "built-in" as const : "repository" as const,
    effectiveStrategy: strategy.strategy,
  };
}

function choiceState(session: AspectSessionState, aspectId: string): TutorAspectChoice["state"] {
  if (session.progress[aspectId]?.done) return "done";
  return session.competence[aspectId] && competenceOf(session, aspectId).shown ? "shown" : "open";
}

/** The aspects the learner can choose from: those of the sketch that have assignments. */
function choices(input: AspectFlowInput, session: AspectSessionState, aspects: readonly DetectedAspect[]): Pick<TutorPlan, "aspectChoices" | "aspectFocus"> {
  const aspectChoices = aspects.flatMap(({ id }) => {
    const definition = input.definitions.find((candidate) => candidate.id === id);
    return definition ? [{ id, title: definition.title, state: choiceState(session, id) }] : [];
  });
  const focus = aspectChoices.some(({ id }) => id === session.focusAspectId) ? session.focusAspectId : undefined;
  return { aspectChoices, ...(focus ? { aspectFocus: focus } : {}) };
}

function toPlan(input: AspectFlowInput, { aspect, assignment, level, site, fallbackQuestion }: AspectStep, offered: Pick<TutorPlan, "aspectChoices" | "aspectFocus">): TutorPlan {
  const topicId = `${ASPECT_TOPIC_PREFIX}${aspect.id}`;
  return {
    topicId,
    topicTitle: aspect.title,
    conceptId: `${aspect.id}-level-${level}`,
    conceptTitle: aspect.title,
    objective: aspect.objective,
    questionId: assignment.id,
    questionKind: QUESTION_KIND[level],
    indicatorId: `level-${level}`,
    indicator: assignment.task,
    question: fallbackQuestion,
    misconceptions: [],
    contentRevision: input.revision,
    learningPhase: "LEARN",
    activeTopicId: topicId,
    masteredTopicIds: [...input.state.masteredTopicIds],
    ...strategyFields(input),
    ...offered,
    assignment: {
      aspectId: aspect.id,
      aspectTitle: aspect.title,
      level,
      levelName: ASPECT_LEVEL_NAMES[level],
      task: assignment.task,
      site: { ...(site.function ? { function: site.function } : {}), line: site.line, endLine: site.endLine, code: site.code, names: [...site.names] },
      ...(assignment.graphic ? { graphic: assignment.graphic } : {}),
      ...(assignment.graphic === "activity-error" ? { graphicNote: activityErrorNote(input.code, site.code) } : {}),
    },
  };
}

/** Every aspect with assignments is handled: the free Tutor continues. */
function exhausted(input: AspectFlowInput): TutorPlanningBlocked {
  return {
    kind: "blocked",
    progressionBlockedReason: "content-exhausted",
    contentRevision: input.revision,
    learningPhase: "LEARN",
    masteredTopicIds: [...input.state.masteredTopicIds],
    ...strategyFields(input),
  };
}

function next(input: AspectFlowInput, session: AspectSessionState, aspects: readonly DetectedAspect[]): TutorPlan | TutorPlanningBlocked {
  const planned = plannable(input, session, aspects);
  let step = planNext(session, planned, drawable(input), input.preferredAspects);
  if (step?.assignment.graphic === "activity-error" && activityErrorNote(input.code, step.site.code) === undefined) {
    // This statement cannot be drawn: the question is withdrawn uncounted and the flow plans without such assignments.
    withdraw(session);
    step = planNext(session, planned, drawable({ ...input, diagrams: false }), input.preferredAspects);
  }
  return step ? toPlan(input, step, choices(input, session, aspects)) : exhausted(input);
}

/** The open assignment is the question the learner acts on: by its fallback wording or by its site. */
function ownsQuestion(session: AspectSessionState, question: string): boolean {
  const open = session.open;
  return open !== undefined && (question === open.fallback || namesAssignmentSite(question, { code: open.siteCode, names: open.siteNames }));
}

/** The open assignment was never delivered: it does not count. */
function withdraw(session: AspectSessionState): void {
  if (!session.open) return;
  const progress = session.progress[session.open.aspectId];
  if (progress) progress.asked = Math.max(0, progress.asked - 1);
  session.open = undefined;
}

/** A question the flow did not plan was answered: its open assignment, if any, was never delivered. */
function dropForeign(session: AspectSessionState, question: string): boolean {
  if (ownsQuestion(session, question)) return false;
  withdraw(session);
  return true;
}

/** The definitions to plan with: a find-the-error question needs a diagram the request can show. */
function drawable({ definitions, diagrams }: AspectFlowInput): readonly AspectDefinition[] {
  if (diagrams) return definitions;
  return definitions.map((definition) => ({ ...definition, assignments: definition.assignments.filter(({ graphic }) => graphic !== "activity-error") }));
}

/** Whether the sketch has an aspect the repository can ask about. */
export function aspectFlowApplies(code: string, definitions: readonly AspectDefinition[]): boolean {
  return detectAspects(code).some(({ id }) => definitions.some((definition) => definition.id === id));
}

export function aspectStartPlan(input: AspectFlowInput): TutorPlan | TutorPlanningBlocked {
  const { session, aspects } = prepare(input);
  return next(input, session, aspects);
}

/** The aspects the learner can choose from with any delivered turn, whatever planned it. */
export function aspectOffer(input: AspectFlowInput): Pick<TutorPlan, "aspectChoices" | "aspectFocus"> {
  const { session, aspects } = prepare(input);
  return choices(input, session, aspects);
}

/** The plan of the question being answered, for the dialog prompt; null when the flow did not plan it. */
export function aspectAnsweredPlan(input: AspectFlowInput, currentQuestion: string): TutorPlan | null {
  const { session, aspects } = prepare(input);
  if (!ownsQuestion(session, currentQuestion)) return null;
  const step = openStep(session, aspects, input.definitions);
  return step ? toPlan(input, step, choices(input, session, aspects)) : null;
}

export function aspectFollowupPlan(input: AspectFlowInput, currentQuestion: string, rating: TutorAnswerRating, supportCycle: boolean): TutorPlan | TutorPlanningBlocked {
  const { session, aspects } = prepare(input);
  // Inside the learning-support cycle a weak answer never reaches this point: the question stays open there.
  if (!dropForeign(session, currentQuestion)) recordAnswer(session, rating, { closeAfterWeak: !supportCycle });
  return next(input, session, aspects);
}

/** A weak answer in the learning-support cycle: recorded unless assisted, the question stays (R-SUP-3). */
export function aspectRetryPlan(input: AspectFlowInput, currentQuestion: string, rating: TutorAnswerRating, assisted: boolean): TutorPlan | null {
  const { session, aspects } = prepare(input);
  if (!ownsQuestion(session, currentQuestion)) return null;
  if (!assisted) recordAnswer(session, rating);
  const step = openStep(session, aspects, input.definitions);
  return step ? toPlan(input, step, choices(input, session, aspects)) : null;
}

/** The question is left by skipping or after the reference answer: no rating, the cap still counts it. */
export function aspectLeaveQuestion(input: AspectFlowInput, currentQuestion: string): void {
  const { session } = prepare(input);
  if (ownsQuestion(session, currentQuestion)) leaveOpen(session);
}

/** The site of the delivered question when its assignment asks for an activity diagram. */
export function aspectQuestionGraphic(input: AspectFlowInput, currentQuestion: string): { kind: "activity" | "activity-error"; siteCode: string } | null {
  const { session, aspects } = prepare(input);
  if (!ownsQuestion(session, currentQuestion)) return null;
  const step = openStep(session, aspects, input.definitions);
  return step?.assignment.graphic ? { kind: step.assignment.graphic, siteCode: step.site.code } : null;
}

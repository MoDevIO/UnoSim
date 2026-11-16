import type { AspectLevel } from "./aspect-schema";

/**
 * What the Tutor knows about a learner's competence, per aspect, for one Tutor session (Tutor concept,
 * stage 2). `competence` outlives a change of sketch; `progress` and `open` belong to the current sketch.
 * It is kept apart from the Topic progression, which is bound to questions of the catalog.
 */
export interface AspectCompetence {
  /** The highest level a question was answered on with a rating of 4 or 5; 0 before the first. */
  level: 0 | AspectLevel;
  /** A question of level 3 or 4 was answered with 4 or 5. */
  shown: boolean;
  ratings: number[];
}

export interface AspectProgress {
  /** Questions delivered for this aspect on the current sketch, skipped ones included (the cap counts them). */
  asked: number;
  ratings: number[];
  nextLevel: AspectLevel;
  /** The last answer raised the level. */
  levelRose: boolean;
  shownHere: boolean;
  /** The one level 4 question after the aspect was shown has been planned. */
  deepeningAsked: boolean;
  /** The aspect was shown on an earlier sketch: one confirming question is enough. */
  confirming: boolean;
  usedAssignmentIds: string[];
  usedSiteIds: string[];
  done: boolean;
}

/** The assignment the learner is answering. The final wording is the model's; the site identifies it. */
export interface OpenAssignment {
  aspectId: string;
  assignmentId: string;
  level: AspectLevel;
  siteId: string;
  siteNames: string[];
  siteCode: string;
  fallback: string;
  weakAttempts: number;
}

export interface AspectSessionState {
  competence: Record<string, AspectCompetence>;
  /** The last ratings of the session, newest last; they set the entry level of the next aspect. */
  recentRatings: number[];
  /** The site ids of the sketch planned last, to tell an edit from another sketch. */
  sketchSiteIds: string[];
  progress: Record<string, AspectProgress>;
  activeAspectId?: string;
  open?: OpenAssignment;
  /** The aspect the learner chose to deepen; it is planned before every other aspect. */
  focusAspectId?: string;
  /** A first question was planned in this session. */
  started: boolean;
}

export const MAX_KEPT_RATINGS = 8;
export const RECENT_RATINGS = 3;

export function createAspectSessionState(): AspectSessionState {
  return { competence: {}, recentRatings: [], sketchSiteIds: [], progress: {}, started: false };
}

export function cloneAspectSessionState(state: AspectSessionState): AspectSessionState {
  return structuredClone(state);
}

export function competenceOf(state: AspectSessionState, aspectId: string): AspectCompetence {
  const existing = state.competence[aspectId];
  if (existing) return existing;
  const created: AspectCompetence = { level: 0, shown: false, ratings: [] };
  state.competence[aspectId] = created;
  return created;
}

export function pushBounded(list: number[], value: number, max: number): void {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

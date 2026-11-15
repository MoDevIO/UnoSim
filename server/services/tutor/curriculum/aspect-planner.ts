import type { AspectSite, DetectedAspect } from "./aspect-detector";
import { fillFallback, type AspectAssignment, type AspectDefinition, type AspectLevel } from "./aspect-schema";
import {
  competenceOf, pushBounded, MAX_KEPT_RATINGS, RECENT_RATINGS,
  type AspectProgress, type AspectSessionState,
} from "./competence-state";

/**
 * The deterministic planner of the aspect flow (Tutor concept, "Ablauf"): the same sketch, answers and
 * ratings give the same sequence of aspect, level, assignment and site. It needs no language model.
 */
export const REGULAR_QUESTIONS_PER_ASPECT = 3;
export const MAX_QUESTIONS_PER_ASPECT = 5;
/** Below this share of surviving sites the code is another sketch, not an edit. */
const SAME_SKETCH_OVERLAP = 0.5;

export interface AspectStep {
  readonly aspect: AspectDefinition;
  readonly assignment: AspectAssignment;
  readonly level: AspectLevel;
  readonly site: AspectSite;
  /** The question the learner gets when the model's wording does not name the site. */
  readonly fallbackQuestion: string;
}

function allSiteIds(aspects: readonly DetectedAspect[]): string[] {
  return aspects.flatMap(({ sites }) => sites.map(({ id }) => id));
}

function findSite(aspects: readonly DetectedAspect[], aspectId: string, siteId: string): AspectSite | undefined {
  return aspects.find(({ id }) => id === aspectId)?.sites.find(({ id }) => id === siteId);
}

/**
 * Brings the state in line with the code of this request. Another sketch starts the counters anew and
 * keeps the competence. After an edit a question of level 1 or 2 whose site is gone is dropped without
 * counting; a question of level 3 or 4 stays, because it asks the learner to change the code.
 */
export function syncSketch(state: AspectSessionState, aspects: readonly DetectedAspect[]): void {
  const now = allSiteIds(aspects);
  const before = state.sketchSiteIds;
  if (before.length > 0) {
    const current = new Set(now);
    const kept = before.filter((id) => current.has(id)).length;
    if (kept / before.length < SAME_SKETCH_OVERLAP) {
      state.progress = {};
      state.open = undefined;
      state.activeAspectId = undefined;
    } else if (state.open && state.open.level <= 2 && !current.has(state.open.siteId)) {
      const progress = state.progress[state.open.aspectId];
      if (progress) progress.asked = Math.max(0, progress.asked - 1);
      state.open = undefined;
    }
  }
  state.sketchSiteIds = now;
}

function entryLevel(state: AspectSessionState, aspectId: string): { level: AspectLevel; confirming: boolean } {
  if (competenceOf(state, aspectId).shown) return { level: 3, confirming: true };
  const recent = state.recentRatings.slice(-RECENT_RATINGS);
  if (!state.started || recent.length === 0) return { level: 2, confirming: false };
  const mean = recent.reduce((sum, rating) => sum + rating, 0) / recent.length;
  if (mean >= 4) return { level: 3, confirming: false };
  if (mean <= 2) return { level: 1, confirming: false };
  return { level: 2, confirming: false };
}

function progressOf(state: AspectSessionState, aspectId: string): AspectProgress {
  const existing = state.progress[aspectId];
  if (existing) return existing;
  const { level, confirming } = entryLevel(state, aspectId);
  const created: AspectProgress = {
    asked: 0, ratings: [], nextLevel: level, levelRose: false, shownHere: false, deepeningAsked: false, confirming, usedAssignmentIds: [], usedSiteIds: [], done: false,
  };
  state.progress[aspectId] = created;
  return created;
}

function hasPotential(progress: AspectProgress): boolean {
  const last = progress.ratings.at(-1);
  const previous = progress.ratings.at(-2);
  const improved = last !== undefined && previous !== undefined && last > previous;
  return improved || (progress.levelRose && !progress.shownHere);
}

/** Whether another question of this aspect may follow, and on which level. */
function nextLevelFor(progress: AspectProgress): AspectLevel | null {
  if (progress.done || progress.asked >= MAX_QUESTIONS_PER_ASPECT) return null;
  if (progress.shownHere) {
    if (progress.confirming || progress.deepeningAsked) return null;
    return 4;
  }
  if (progress.asked >= REGULAR_QUESTIONS_PER_ASPECT && !hasPotential(progress)) return null;
  return progress.nextLevel;
}

function offers(site: AspectSite, assignment: AspectAssignment): boolean {
  return (assignment.needs ?? []).every((feature) => site.has.includes(feature));
}

/** A site whose code holds a question mark cannot be quoted: the question would count as two. */
function quotable(site: AspectSite): boolean {
  return !site.code.includes("?") && site.code.trim() !== "";
}

/** What kind of place a site is: where it stands and what it offers. */
function siteKind(site: AspectSite): string {
  return `${site.function ?? ""}|${site.has.join(",")}`;
}

function pickOnLevel(aspect: AspectDefinition, sites: readonly AspectSite[], progress: AspectProgress, level: AspectLevel): { assignment: AspectAssignment; site: AspectSite } | null {
  const assignments = aspect.assignments.filter((assignment) => assignment.level === level);
  const fresh = assignments.filter(({ id }) => !progress.usedAssignmentIds.includes(id));
  const usable = sites.filter(quotable);
  // Among the sites not asked about yet, one of another kind comes first: a sketch with five pin
  // constants should not get three questions about pin constants.
  const usedKinds = new Set(sites.filter(({ id }) => progress.usedSiteIds.includes(id)).map(siteKind));
  const unused = usable.filter(({ id }) => !progress.usedSiteIds.includes(id));
  const freshSites = [...unused.filter((site) => !usedKinds.has(siteKind(site))), ...unused.filter((site) => usedKinds.has(siteKind(site)))];
  const usedSites = usable.filter(({ id }) => progress.usedSiteIds.includes(id));
  // Another site first; on a site already used only an assignment that was not used yet.
  for (const assignmentList of [fresh, assignments]) {
    for (const site of freshSites) {
      const assignment = assignmentList.find((candidate) => offers(site, candidate));
      if (assignment) return { assignment, site };
    }
  }
  // Every site was asked about: the file's order of assignments decides, so the first one that fits any
  // site wins, not whatever fits the first site.
  for (const assignment of fresh) {
    const site = usedSites.find((candidate) => offers(candidate, assignment));
    if (site) return { assignment, site };
  }
  return null;
}

function pick(aspect: AspectDefinition, sites: readonly AspectSite[], progress: AspectProgress, wanted: AspectLevel): { assignment: AspectAssignment; site: AspectSite } | null {
  const lower = [1, 2, 3, 4].filter((level) => level < wanted).reverse();
  const higher = [1, 2, 3, 4].filter((level) => level > wanted);
  // After the aspect was shown only the level 4 question remains; a lower one would step back.
  const levels = progress.shownHere ? [wanted] : [wanted, ...lower, ...higher];
  for (const level of levels) {
    const found = pickOnLevel(aspect, sites, progress, level as AspectLevel);
    if (found) return found;
  }
  return null;
}

function stepFor(aspect: AspectDefinition, assignment: AspectAssignment, site: AspectSite): AspectStep {
  return {
    aspect, assignment, level: assignment.level, site,
    fallbackQuestion: fillFallback(assignment.fallback, { code: site.code, ...(site.function ? { function: site.function } : {}), ...(site.names[0] ? { name: site.names[0] } : {}) }),
  };
}

/** The step of the question the learner is answering; undefined when its aspect or assignment is gone. */
export function openStep(state: AspectSessionState, aspects: readonly DetectedAspect[], definitions: readonly AspectDefinition[]): AspectStep | undefined {
  const open = state.open;
  if (!open) return undefined;
  const aspect = definitions.find(({ id }) => id === open.aspectId);
  const assignment = aspect?.assignments.find(({ id }) => id === open.assignmentId);
  if (!aspect || !assignment) return undefined;
  const site = findSite(aspects, open.aspectId, open.siteId)
    ?? { id: open.siteId, line: 0, endLine: 0, code: open.siteCode, names: open.siteNames, has: [] };
  return { aspect, assignment, level: open.level, site, fallbackQuestion: open.fallback };
}

/**
 * Plans the next question and marks it as open. An open question is returned unchanged. Null means that
 * every aspect with assignments has been handled on this sketch.
 */
export function planNext(state: AspectSessionState, aspects: readonly DetectedAspect[], definitions: readonly AspectDefinition[]): AspectStep | null {
  const stillOpen = openStep(state, aspects, definitions);
  if (stillOpen) return stillOpen;
  state.open = undefined;
  const available = aspects.flatMap((detected) => {
    const definition = definitions.find(({ id }) => id === detected.id);
    return definition ? [{ detected, definition }] : [];
  });
  const active = available.find(({ detected }) => detected.id === state.activeAspectId);
  const candidates = [...(active ? [active] : []), ...available.filter((entry) => entry !== active)];
  for (const { detected, definition } of candidates) {
    const progress = progressOf(state, detected.id);
    const level = nextLevelFor(progress);
    const found = level === null ? null : pick(definition, detected.sites, progress, level);
    if (!found) {
      progress.done = true;
      continue;
    }
    const step = stepFor(definition, found.assignment, found.site);
    progress.asked++;
    if (progress.shownHere) progress.deepeningAsked = true;
    if (!progress.usedAssignmentIds.includes(found.assignment.id)) progress.usedAssignmentIds.push(found.assignment.id);
    if (!progress.usedSiteIds.includes(found.site.id)) progress.usedSiteIds.push(found.site.id);
    state.activeAspectId = detected.id;
    state.started = true;
    state.open = {
      aspectId: detected.id, assignmentId: found.assignment.id, level: found.assignment.level, siteId: found.site.id,
      siteNames: [...found.site.names], siteCode: found.site.code, fallback: step.fallbackQuestion, weakAttempts: 0,
    };
    return step;
  }
  state.activeAspectId = undefined;
  return null;
}

function lower(level: AspectLevel): AspectLevel {
  return Math.max(1, level - 1) as AspectLevel;
}

function close(state: AspectSessionState, progress: AspectProgress, nextLevel: AspectLevel, rose: boolean): void {
  progress.nextLevel = nextLevel;
  progress.levelRose = rose;
  state.open = undefined;
}

/**
 * Records the rating of the open question. A weak answer keeps the question open; `closeAfterWeak` ends
 * it after the second weak answer and steps one level down (for callers without the learning-support
 * cycle, which keeps a question open until the learner leaves it).
 */
export function recordAnswer(state: AspectSessionState, rating: number, options: { readonly closeAfterWeak?: boolean } = {}): "retained" | "closed" | "none" {
  const open = state.open;
  if (!open) return "none";
  const progress = progressOf(state, open.aspectId);
  const competence = competenceOf(state, open.aspectId);
  pushBounded(competence.ratings, rating, MAX_KEPT_RATINGS);
  pushBounded(progress.ratings, rating, MAX_KEPT_RATINGS);
  pushBounded(state.recentRatings, rating, RECENT_RATINGS);
  if (rating <= 2) {
    open.weakAttempts++;
    if (!options.closeAfterWeak || open.weakAttempts < 2) return "retained";
    close(state, progress, lower(open.level), false);
    return "closed";
  }
  // Two weak attempts came first: the answer was reached with hints and does not prove the level.
  if (open.weakAttempts >= 2) {
    close(state, progress, rating >= 4 ? open.level : lower(open.level), false);
    return "closed";
  }
  if (rating === 3) {
    close(state, progress, open.level, false);
    return "closed";
  }
  if (open.level > competence.level) competence.level = open.level;
  if (open.level >= 3) {
    competence.shown = true;
    progress.shownHere = true;
  }
  close(state, progress, Math.min(4, open.level + 1) as AspectLevel, true);
  return "closed";
}

/** The learner skipped the question or saw the reference answer: no rating, but it counts for the cap. */
export function leaveOpen(state: AspectSessionState): void {
  const open = state.open;
  if (!open) return;
  const progress = progressOf(state, open.aspectId);
  close(state, progress, open.weakAttempts >= 2 ? lower(open.level) : open.level, false);
}

import { z } from "zod";
import { boundedArray } from "@shared/bounded-array";
import { ASPECT_IDS, SITE_FEATURES } from "./aspect-detector";
import { hasUnanchoredReference } from "../question-concreteness";

/**
 * An aspect file of the Course Content (`tutor/aspects/<id>.yaml`): what the learner should be able to do
 * with one aspect of a sketch, and the question assignments that probe it on four levels. An assignment
 * holds no finished question: it tells the model what to ask about a place the server chose.
 */
export const ASPECT_LEVELS = [1, 2, 3, 4] as const;
export type AspectLevel = typeof ASPECT_LEVELS[number];
/** 1 recognize, 2 explain, 3 predict, 4 change. */
export const ASPECT_LEVEL_NAMES: Readonly<Record<AspectLevel, string>> = { 1: "Erkennen", 2: "Erklären", 3: "Vorhersagen", 4: "Verändern" };
export const MIN_ASSIGNMENTS_PER_LEVEL = 2;

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;
/** The slots a fallback question may use; the server fills them from the chosen site. */
const FALLBACK_SLOTS = ["code", "function", "name"] as const;
const SLOT = /\{([a-z]+)\}/g;

const hasControlCharacters = (value: string): boolean => [...value].some((character) => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
});

const boundedText = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !hasControlCharacters(value), "Control characters are not allowed")
  .refine((value) => !/https?:\/\//i.test(value), "URLs are not allowed in aspect text");

const assignmentSchema = z.object({
  id: z.string().regex(SAFE_ID),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /** What the question must make the learner do, addressed to the model. */
  task: boundedText(600),
  /** What the site must offer; without it the assignment cannot be chosen for that site. */
  needs: boundedArray(z.enum(SITE_FEATURES), 6).optional(),
  /** The question the learner gets when the model's wording does not name the site. */
  fallback: boundedText(400),
  graphic: z.enum(["activity", "activity-error"]).optional(),
}).strict();

export const aspectDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.enum(ASPECT_IDS),
  title: boundedText(80),
  objective: boundedText(300),
  assignments: boundedArray(assignmentSchema, 48),
}).strict();

export type AspectDefinition = z.infer<typeof aspectDefinitionSchema>;
export type AspectAssignment = AspectDefinition["assignments"][number];

/** The diagram aspect has nothing to ask without the diagram the application draws. */
function requireGraphics(aspect: AspectDefinition): void {
  if (aspect.id !== "diagrams") return;
  const bare = aspect.assignments.find(({ graphic }) => graphic === undefined);
  if (bare) throw new Error(`Assignment ${bare.id} of the diagram aspect needs a graphic`);
}

/** Rules a schema cannot express; throws with the first violation, like `validateCurriculumTopic`. */
export function validateAspectDefinition(aspect: AspectDefinition): AspectDefinition {
  const ids = new Set<string>();
  for (const assignment of aspect.assignments) {
    if (ids.has(assignment.id)) throw new Error(`Duplicate assignment: ${assignment.id}`);
    ids.add(assignment.id);
    const slots = [...assignment.fallback.matchAll(SLOT)].map((match) => match[1] ?? "");
    const unknown = slots.find((slot) => !(FALLBACK_SLOTS as readonly string[]).includes(slot));
    if (unknown !== undefined) throw new Error(`Unknown slot {${unknown}} in the fallback of ${assignment.id}`);
    if (!slots.includes("code") && !slots.includes("name")) throw new Error(`The fallback of ${assignment.id} must name its site with {code} or {name}`);
    if ((assignment.fallback.match(/\?/g) ?? []).length !== 1) throw new Error(`The fallback of ${assignment.id} must be exactly one question`);
    if (hasUnanchoredReference(fillFallback(assignment.fallback, { code: "x", function: "loop", name: "x" }))) {
      throw new Error(`The fallback of ${assignment.id} refers to an element it does not name`);
    }
  }
  requireGraphics(aspect);
  for (const level of ASPECT_LEVELS) {
    if (aspect.assignments.filter((assignment) => assignment.level === level).length < MIN_ASSIGNMENTS_PER_LEVEL) {
      throw new Error(`Aspect ${aspect.id} needs at least ${MIN_ASSIGNMENTS_PER_LEVEL} assignments on level ${level}`);
    }
  }
  return aspect;
}

/** Puts the site into a fallback question; code and names are quoted, so the question names its place. */
export function fillFallback(fallback: string, site: { readonly code: string; readonly function?: string; readonly name?: string }): string {
  const values: Record<string, string> = {
    code: `\`${site.code.replaceAll("`", "'")}\``,
    function: site.function ? `\`${site.function}()\`` : "dem Sketch",
    name: `\`${site.name ?? site.code.replaceAll("`", "'")}\``,
  };
  return fallback.replaceAll(SLOT, (whole, slot: string) => values[slot] ?? whole);
}

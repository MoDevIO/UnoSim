import type { TutorAssignment, TutorFollowUpPreview } from "./tutor-planning";

/**
 * Prompt text of the aspect flow (Tutor concept, stage 2): the application decides what the question
 * probes and where; the model words it. The texts are part of the prompt revision.
 */
export const TUTOR_ASSIGNMENT_GUIDANCE_TEXT = {
  initial: "Frageauftrag der Anwendung (verbindlich für `question`, Vorrang vor allgemeinen Hinweisen zur Themenwahl):",
  followUp: "Frageauftrag der Anwendung für die Folgefrage (verbindlich für `question`, Vorrang vor allgemeinen Hinweisen zur Folgefrage). Er hängt von deinem answerRating ab:",
  rule: "Die Frage betrifft genau diese Stelle und nennt sie wörtlich: den Code der Stelle in Backticks oder einen ihrer Bezeichner. Sie nennt die gesuchte Antwort nicht.",
  weak: "Bei answerRating 1 oder 2 bleibt die aktuelle Frage offen: gib im feedback einen Hinweis und wiederhole in `question` die aktuelle Frage sinngemäß.",
} as const;

function describe({ aspectTitle, level, levelName, task, site }: TutorAssignment): string {
  const place = site.function ? `Funktion \`${site.function}()\`, Zeile ${site.line}` : `Zeile ${site.line}`;
  const quoted = site.names.map((name) => "`" + name + "`").join(", ");
  const names = quoted ? ` Bezeichner: ${quoted}.` : "";
  return `Aspekt „${aspectTitle}“, Stufe ${level} von 4 (${levelName}). Auftrag: ${task} Stelle im Sketch: ${place}: \`${site.code}\`.${names}`;
}

export function buildAssignmentGuidance(assignment: TutorAssignment | undefined): string[] {
  if (!assignment) return [];
  return [TUTOR_ASSIGNMENT_GUIDANCE_TEXT.initial, describe(assignment), TUTOR_ASSIGNMENT_GUIDANCE_TEXT.rule];
}

function ratingsText(ratings: readonly number[]): string {
  const sorted = [...ratings].sort((left, right) => left - right);
  return sorted.length === 1 ? `${sorted[0]}` : `${sorted.slice(0, -1).join(", ")} oder ${sorted.at(-1)}`;
}

export function buildFollowUpAssignmentGuidance(previews: readonly TutorFollowUpPreview[] | undefined): string[] {
  if (!previews?.length) return [];
  return [
    TUTOR_ASSIGNMENT_GUIDANCE_TEXT.followUp,
    ...previews.map(({ ratings, assignment }) => `- Bei answerRating ${ratingsText(ratings)}: ${describe(assignment)}`),
    `- ${TUTOR_ASSIGNMENT_GUIDANCE_TEXT.weak}`,
    TUTOR_ASSIGNMENT_GUIDANCE_TEXT.rule,
  ];
}

const WORD = /[A-Za-z_]\w*/g;

function squeeze(value: string): string {
  return value.replaceAll(/[\s`]+/g, "");
}

/**
 * Whether the question names the site of its assignment: one of the site's identifiers as a word, or the
 * site's code. A bounded wording rule, like `question-concreteness.ts`; it does not judge the meaning.
 */
export function namesAssignmentSite(question: string, site: Pick<TutorAssignment["site"], "code" | "names">): boolean {
  const words = new Set(question.match(WORD) ?? []);
  if (site.names.some((name) => words.has(name))) return true;
  const code = squeeze(site.code);
  return code.length >= 3 && squeeze(question).includes(code);
}

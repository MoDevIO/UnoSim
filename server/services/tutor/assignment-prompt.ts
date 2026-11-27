import type { TutorAssignment, TutorFollowUpPreview } from "./tutor-planning";

/**
 * Prompt text of the aspect flow (Tutor concept, stage 2): the application decides what the question
 * probes and where; the model words it. The texts are part of the prompt revision.
 */
export const TUTOR_ASSIGNMENT_GUIDANCE_TEXT = {
  initial: "Frageauftrag der Anwendung (verbindlich für `question`, Vorrang vor allgemeinen Hinweisen zur Themenwahl):",
  followUp: "Frageauftrag der Anwendung für die Folgefrage (verbindlich für `question`, Vorrang vor allgemeinen Hinweisen zur Folgefrage). Er hängt von deinem answerRating ab:",
  rule: "Die Frage betrifft genau diese Stelle und nennt sie wörtlich: den Code der Stelle in Backticks oder einen ihrer Bezeichner. Sie nennt die gesuchte Antwort nicht.",
  parts: "Verlangt ein Auftrag der Stufe 4 zwei Teile (etwa eine Änderung und eine Beobachtung im Simulator), nennt die Frage beide ausdrücklich als Teile der erwarteten Antwort, mit „erstens“ und „zweitens“, und bleibt dabei ein einziger Fragesatz.",
  errorDiagram: "Die Anwendung zeigt zur Frage ein Aktivitätsdiagramm dieser Anweisung, in das sie genau einen Fehler eingebaut hat. Die Frage fordert auf, den Fehler im Diagramm durch Vergleich mit dem Code zu finden und zu begründen; sie verrät weder die Stelle noch die Art des Fehlers. Eingebauter Fehler, nur für deine Bewertung:",
  graphic: "Zur Frage zeigt die Anwendung eine Grafik. Die Frage verlangt nichts, was wörtlich in der Grafik steht und nur abgelesen werden müsste, etwa eine Kantenbeschriftung oder den Text eines Knotens; sie fragt nach Bedeutung, Zuordnung zum Code oder Ablauf. Das gilt auch bei niedriger Schwierigkeit.",
  weak: "Bei answerRating 1 oder 2 bleibt die aktuelle Frage offen: gib im feedback einen Hinweis und wiederhole in `question` die aktuelle Frage sinngemäß.",
} as const;

function describe({ aspectTitle, level, levelName, task, site, graphic, graphicNote }: TutorAssignment): string {
  const place = site.function ? `Funktion \`${site.function}()\`, Zeile ${site.line}` : `Zeile ${site.line}`;
  const quoted = site.names.map((name) => "`" + name + "`").join(", ");
  const names = quoted ? ` Bezeichner: ${quoted}.` : "";
  const diagram = graphic === "activity-error" && graphicNote ? ` ${TUTOR_ASSIGNMENT_GUIDANCE_TEXT.errorDiagram} ${graphicNote}` : "";
  return `Aspekt „${aspectTitle}“, Stufe ${level} von 4 (${levelName}). Auftrag: ${task} Stelle im Sketch: ${place}: \`${site.code}\`.${names}${diagram}`;
}

/** A question beside a graphic must not be answered by reading a label off it (review6: "Welche Kantenbeschriftung …?"). */
function graphicRule(assignments: readonly TutorAssignment[]): string[] {
  return assignments.some(({ graphic }) => graphic) ? [TUTOR_ASSIGNMENT_GUIDANCE_TEXT.graphic] : [];
}

/** Only a level 4 assignment asks for a change and its observation; lower levels read stiff with the rule. */
function partsRule(assignments: readonly TutorAssignment[]): string[] {
  return assignments.some(({ level }) => level === 4) ? [TUTOR_ASSIGNMENT_GUIDANCE_TEXT.parts] : [];
}

export function buildAssignmentGuidance(assignment: TutorAssignment | undefined): string[] {
  if (!assignment) return [];
  return [TUTOR_ASSIGNMENT_GUIDANCE_TEXT.initial, describe(assignment), TUTOR_ASSIGNMENT_GUIDANCE_TEXT.rule, ...graphicRule([assignment]), ...partsRule([assignment])];
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
    ...graphicRule(previews.map(({ assignment }) => assignment)),
    ...partsRule(previews.map(({ assignment }) => assignment)),
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

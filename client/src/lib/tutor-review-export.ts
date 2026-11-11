import { TUTOR_ASSESSMENT_GUIDANCE_REVISION, TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import {
  TUTOR_REVIEW_FORMAT, TUTOR_REVIEW_FORMAT_VERSION, TUTOR_REVIEW_LIMITS,
  type TutorReviewExport, type TutorReviewImportedTurn, type TutorReviewServerEntry, type TutorReviewStep,
} from "@shared/tutor-review";
import type { TutorReviewRun } from "./tutor-review-store";
import { utf8Bytes, visible } from "./tutor-review-text";

/**
 * Builds the one-click Tutor review export (LearningQuestions 12.7): header, readable protocol, code contexts,
 * legend, JSON record and closing marker. The protocol and legend are German; content stays verbatim text.
 */

const kib = (bytes: number): string => (bytes / 1024).toFixed(1);

/** Appends one by one; spreading a long list into `push` arguments can exhaust the call stack. */
function append(target: string[], items: readonly string[]): void {
  for (const item of items) target.push(item);
}

/** Every content line carries a prefix, so no content line can pass for a section heading. */
function block(label: string, value: string | undefined, indent = "    "): string[] {
  if (value === undefined) return [];
  const lines = visible(value).split(/\r?\n/);
  return [`${indent}${label}:`, ...lines.map((line) => `${indent}  | ${line}`)];
}

/** ` (detail)` when there is a detail, else nothing. */
const inParentheses = (detail: string | number | undefined): string => (detail === undefined || detail === "" ? "" : ` (${detail})`);

const line = (label: string, value: string | number | undefined, indent = "    "): string[] =>
  value === undefined || value === "" ? [] : [`${indent}${label}: ${visible(String(value))}`];

const STEP_TITLE: Record<TutorReviewStep["kind"], string> = {
  question: "Neue Frage angefordert",
  answer: "Antwort abgeschickt",
  support: "Lernhilfe angefordert",
  models: "Modellliste geladen",
  held: "Nächste Frage bis „Weiter“ zurückgehalten",
  displayed: "Zurückgehaltene Frage nach „Weiter“ angezeigt",
  reset: "Dialog zurückgesetzt (neue Lernrunde oder Kontextwechsel)",
  "rating-summary": "Bewertungsübersicht",
};

const STATUS_TEXT: Record<TutorReviewStep["status"], string> = {
  open: "offen (noch keine Antwort)",
  completed: "abgeschlossen",
  failed: "fehlgeschlagen",
  aborted: "abgebrochen",
  discarded: "verworfen",
  recorded: "erfasst",
};

const ACTION_TEXT: Record<string, string> = { clarify: "Klärung der Frage", hint: "Hinweis", reveal: "Musterantwort anzeigen", skip: "Frage überspringen" };

function contextLabels(run: Pick<TutorReviewRun, "contexts">): Map<string, string> {
  return new Map(run.contexts.map((context, index) => [context.contextId, `K${index + 1}`]));
}

function ratingText(step: TutorReviewStep): string | undefined {
  const response = step.response;
  if (!response || step.kind !== "answer") return undefined;
  if (response.answerRating !== undefined) return `${response.answerRating}/5`;
  if (response.learnerInput && response.learnerInput !== "answer") return `keine (Eingabe als ${response.learnerInput} eingestuft)`;
  if (response.responseStyle === "philosophical") return "keine (philosophische Rückführung)";
  return "keine (Antwort ohne Bewertung ausgeliefert)";
}

function graphicText(step: TutorReviewStep): string | undefined {
  const graphicEvents = step.events.filter((event) => ["safety", "content", "renderer", "browser"].includes(event.stage) && (event.diagramId !== undefined || event.stage === "content"));
  const outcome = step.server?.entries.find((entry): entry is Extract<TutorReviewServerEntry, { kind: "outcome" }> => entry.kind === "outcome");
  const draft = step.server?.entries.some((entry) => entry.kind === "draft" && entry.mermaid !== undefined);
  const parts = [
    ...(outcome ? [`Server: ${outcome.graphic}`] : []),
    ...(draft ? ["Entwurf enthielt eine Grafik"] : []),
    ...graphicEvents.map((event) => `${event.stage}: ${event.outcome}${inParentheses(event.reason)}`),
  ];
  return parts.length ? parts.join("; ") : undefined;
}

function serverLines(step: TutorReviewStep, missingGuidance: ReadonlySet<string>): string[] {
  const server = step.server;
  if (!server) return [];
  if (server.status !== "received") {
    const reason = server.status === "disabled" ? "Serverdiagnose aus" : server.status;
    return line("Serverdaten", `nicht verfügbar (${reason}); Bewertungsregeln dieses Requests unbekannt`);
  }
  const missing = server.guidanceRevision && missingGuidance.has(server.guidanceRevision) ? " (Regeltexte nicht erfasst: Grenze erreicht)" : "";
  const lines = line("Prompt", server.promptRevision ? `${server.promptRevision.id} (Digest ${server.promptRevision.templateDigest.slice(0, 12)}…), Regeln ${server.guidanceRevision}${missing}` : undefined);
  for (const entry of server.entries) append(lines, serverEntryLines(entry));
  if (server.dropped) append(lines, line("Servereinträge verworfen (Grenze)", server.dropped));
  return lines;
}

function serverEntryLines(entry: TutorReviewServerEntry): string[] {
  switch (entry.kind) {
    case "draft":
      return [
        `    Modellentwurf (Versuch ${entry.attempt}):`,
        ...block("Frage", entry.question, "      "), ...block("Feedback", entry.feedback, "      "),
        ...line("Bewertung", entry.answerRating === undefined ? undefined : `${entry.answerRating}/5`, "      "),
        ...line("Antwortstil", entry.responseStyle, "      "), ...block("Mermaid", entry.mermaid, "      "),
      ];
    case "decision":
      return [`    Entscheidung: ${entry.trigger}`, ...block("vorher", entry.before, "      "), ...block("nachher", entry.after, "      ")];
    case "outcome":
      return line("Ergebnisquelle", `${entry.followUpSource}${entry.retained ? ", Frage bleibt offen" : ""}${entry.withoutProvider ? ", ohne Modellaufruf" : ""}`);
    case "classification":
      return line("Servereinstufung der Eingabe", entry.learnerInput);
    case "facts":
      return entry.json ? block("Sketchfakten (deterministisch, JSON)", entry.json) : line("Sketchfakten", "ausgelassen (zu groß)");
    case "replay":
      return line("Replay", "gespeichertes Ergebnis wiederholt, kein neuer Modellaufruf");
  }
}

function modelText(step: TutorReviewStep): string | undefined {
  if (step.kind === "models") return undefined;
  const requested = step.request?.requestedModel ?? (step.request ? "auto" : undefined);
  const returnedEvent = step.events.find((event) => event.modelReturned !== undefined);
  const returned = returnedEvent?.modelReturned ?? step.response?.model;
  if (!requested && !returned) return undefined;
  return `angefragt ${requested ?? "unbekannt"} / zurückgemeldet ${returned ?? "unbekannt"}`;
}

/** Where each sent history entry comes from; the import reasons index `importedHistory` by `importId`. */
export interface TutorReviewStepRefs {
  readonly labels: Map<string, string>;
  readonly stepNumbers: Map<string, number>;
  readonly imports: Map<string, TutorReviewImportedTurn["reason"]>;
  /** Server rule revisions whose texts the run could not keep. */
  readonly missingGuidance: ReadonlySet<string>;
}

const IMPORT_TEXT: Record<TutorReviewImportedTurn["reason"], string> = {
  "before-capture": "Vorgeschichte vor dem Mitschnitt",
  ambiguous: "Eintrag ohne eindeutigen Schritt (wörtlich unter importedHistory)",
};

function historyText(step: TutorReviewStep, refs: TutorReviewStepRefs): string | undefined {
  const history = step.request?.history ?? [];
  if (history.length === 0) return undefined;
  return history.map((ref) => "stepId" in ref
    ? `Schritt ${refs.stepNumbers.get(ref.stepId) ?? "?"}`
    : IMPORT_TEXT[refs.imports.get(ref.importId) ?? "before-capture"]).join(", ");
}

function stepHeading(step: TutorReviewStep, number: number, { labels, stepNumbers }: TutorReviewStepRefs): string {
  const action = step.request?.action;
  const title = action ? `${STEP_TITLE[step.kind]}: ${ACTION_TEXT[action] ?? action}` : STEP_TITLE[step.kind];
  const context = step.contextId ? `Kontext ${labels.get(step.contextId)}` : "ohne Kontext";
  const related = step.relatesTo ? stepNumbers.get(step.relatesTo) : undefined;
  let relation = "";
  if (step.attempt && step.attempt > 1) relation = ` · Wiederholung ${step.attempt} von Schritt ${related ?? "?"}`;
  else if (!step.attempt && related) relation = ` · zu Schritt ${related}`;
  return `[${number}] ${title} · ${context} · ${step.at} · ${STATUS_TEXT[step.status]}${relation}`;
}

function courseText(request: TutorReviewStep["request"]): string | undefined {
  const course = request?.courseContent;
  if (!course) return undefined;
  return `${course.repository}@${course.revision}${inParentheses(course.exampleId)}`;
}

const QUESTION_STATUS_TEXT = { open: "offen (dieselbe Frage bleibt)", closed: "geschlossen, nächste Frage folgt" } as const;

function failureText(failure: TutorReviewStep["failure"]): string | undefined {
  if (!failure) return undefined;
  const http = failure.httpStatus ? `HTTP ${failure.httpStatus}` : undefined;
  return `${failure.code ?? "unbekannt"}${inParentheses(http)}`;
}

function referenceText(response: TutorReviewStep["response"]): string | undefined {
  const reference = response?.reference;
  return reference?.status === "available" ? `${reference.answer}\n${reference.explanation}` : undefined;
}

type Shown = Pick<NonNullable<TutorReviewStep["response"]>, "topic" | "difficulty" | "learning"> | undefined;

function topicText(shown: Shown): string | undefined {
  if (!shown?.topic && !shown?.difficulty) return undefined;
  return `${shown.topic ?? "–"} / ${shown.difficulty ?? "–"}`;
}

function learningText(shown: Shown): string | undefined {
  return shown?.learning ? Object.entries(shown.learning).map(([key, value]) => `${key}=${value}`).join(", ") : undefined;
}

/** The question a skip moved to, as the learning area shows it. */
function nextLines(next: NonNullable<TutorReviewStep["response"]>["next"]): string[] {
  if (!next) return [];
  return [
    ...block("Nächste Frage", next.question),
    ...block("Feedback zur nächsten Frage", next.feedback),
    ...line("Nächste Frage: Thema / Schwierigkeit", topicText(next)),
    ...line("Nächste Frage: Lernkontext", learningText(next)),
    ...block("Nächste Frage: Mermaid (ausgeliefert)", next.mermaid),
  ];
}

/** What the learner sent with this step. */
function requestLines(step: TutorReviewStep, refs: TutorReviewStepRefs): string[] {
  const request = step.request;
  return [
    ...block("Beantwortete Frage", request?.askedQuestion),
    ...block("Antwort", request?.answer),
    ...line("Mitgesendete Historie", historyText(step, refs)),
    ...line("Schwierigkeit (gesendet)", request?.difficulty),
    ...line("Kursinhalt", courseText(request)),
  ];
}

/** What the Tutor delivered for this step. */
function responseLines(step: TutorReviewStep): string[] {
  const response = step.response;
  return [
    ...line("Eingabe eingestuft als", response?.learnerInput),
    ...line("Bewertung", ratingText(step)),
    ...line("Antwortstil", response?.responseStyle),
    ...block("Feedback", response?.feedback),
    ...block("Erklärung", response?.explanation),
    ...block("Musterantwort (angezeigt)", referenceText(response)),
    ...line("Fragestatus", response?.questionStatus ? QUESTION_STATUS_TEXT[response.questionStatus] : undefined),
    ...block(step.kind === "answer" ? "Folgefrage" : "Frage", response?.question),
    ...line("Thema / Schwierigkeit", topicText(response)),
    ...line("Lernkontext", learningText(response)),
    ...block("Mermaid (ausgeliefert)", response?.mermaid),
    ...nextLines(response?.next),
  ];
}

/** The readable protocol lines of one step; also used for the step details in the Debug tab. */
export function formatTutorReviewStep(step: TutorReviewStep, number: number, refs: TutorReviewStepRefs): string[] {
  return [
    stepHeading(step, number, refs),
    ...requestLines(step, refs),
    ...responseLines(step),
    ...line("Grafik", graphicText(step)),
    ...line("Modell", modelText(step)),
    ...serverLines(step, refs.missingGuidance),
    ...line("Fehler", failureText(step.failure)),
    ...line("Hinweis", step.note),
  ];
}

const LEGEND_FIXED = [
  "responseStyle: normal = fachliche Antwort mit Bewertung; philosophical = Rückführung bei unsinniger oder themenfremder Eingabe, ohne Bewertung.",
  "Eingabe eingestuft als: answer = Antwort auf die Frage (wird bewertet); clarification = Rückfrage zur Frage (Klärung, keine Bewertung); help = Bitte um Hilfe (Hinweis, keine Bewertung).",
  "Fragestatus: open = die Frage bleibt nach einer schwachen Antwort offen; closed = die Frage ist beantwortet, die nächste wird bis „Weiter“ zurückgehalten.",
  "Entscheidung: planner-question = Frage aus dem Lernplan statt Modellfrage; repetition-fallback = Wiederholung einer schon gestellten Frage ersetzt; retain-open-question = gestellte Frage bleibt offen; planned-question-rejected = geplante Frage verletzte Qualitätsregeln, Modellfrage verwendet; non-learning-fallback = Rückführung ohne Modellaufruf; assisted-question-left = Frage nach angezeigter Musterantwort verlassen.",
  "Ergebnisquelle: provider = Modell; planner = Lernplan; application-fallback = Anwendung ohne Modellfrage.",
  "Grafik: kept = ausgeliefert; discarded = Entwurf hatte eine Grafik, die nicht ausgeliefert wurde; none = keine Grafik. Ereignisse: safety = Sicherheitsprüfung, content = fachliche Zuordnung, browser held/displayed = bis „Weiter“ zurückgehalten/angezeigt, renderer rendered = als SVG im Tutor eingebunden.",
  "Vollständigkeit: capture-started-late = Mitschnitt begann während eines laufenden Dialogs; capture-disabled = DEBUG ausgeschaltet; capture-limit = Größen- oder Anzahlgrenze erreicht; server-review-unavailable = keine Serverdaten (z. B. Serverdiagnose aus); review-invalid = ungültiger Serverblock verworfen; request-aborted = Anfrage abgebrochen; server-review-truncated = Server hat Einträge an seiner Grenze verworfen oder Sketchfakten ausgelassen.",
  "Markierung ⟦U+XXXX⟧: Steuerzeichen im Originaltext. [REDACTED-CREDENTIAL]: unkenntlich gemachter Zugangsschlüssel.",
];

/** Confirmed only when every server-reported rule set equals the client's revision and texts. */
function legendConfirmation(run: TutorReviewRun): TutorReviewExport["legend"]["confirmation"] {
  if (!run.steps.some((step) => step.server?.guidanceRevision)) return "client-only";
  return run.guidanceSets.length === 0 && run.missingGuidance.size === 0 ? "confirmed-by-server" : "differs-from-server";
}

/** The JSON record of a run as of `exportedAt`; validated against `tutorReviewExportSchema` in tests. */
export function tutorReviewRecord(run: TutorReviewRun, exportedAt: string): TutorReviewExport {
  const openSteps = run.steps.filter((step) => step.status === "open").length;
  const incompleteReasons = [...run.incomplete];
  return {
    format: TUTOR_REVIEW_FORMAT,
    formatVersion: TUTOR_REVIEW_FORMAT_VERSION,
    runId: run.runId,
    exportedAt,
    startedAt: run.startedAt,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    appRevision: "unknown",
    capture: {
      status: run.status,
      complete: incompleteReasons.length === 0 && run.notCaptured === 0,
      incompleteReasons,
      ...(run.stoppedReason ? { stoppedReason: run.stoppedReason } : {}),
      sanitizedTexts: run.sanitized,
      notCapturedActions: run.notCaptured,
      openSteps,
      requestAttempts: run.requestAttempts,
    },
    legend: {
      guidanceRevision: TUTOR_ASSESSMENT_GUIDANCE_REVISION,
      confirmation: legendConfirmation(run),
      ratingRubric: TUTOR_RATING_RUBRIC,
      difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE,
      serverSets: run.guidanceSets,
      missingServerSets: [...run.missingGuidance],
    },
    contexts: run.contexts,
    importedHistory: run.importedHistory,
    steps: [
      ...run.steps,
      ...(run.ratingSummary ? [{
        stepId: run.runId, sequence: Number.MAX_SAFE_INTEGER, at: exportedAt, kind: "rating-summary" as const, status: "recorded" as const,
        note: "rating-summary" as const, ratingSummary: run.ratingSummary, events: [],
      }] : []),
    ],
  };
}

function completenessText(capture: TutorReviewExport["capture"]): string {
  if (capture.complete) return "ja";
  const notCaptured = capture.notCapturedActions ? [`${capture.notCapturedActions} Aktionen nicht erfasst`] : [];
  return `nein (${[...capture.incompleteReasons, ...notCaptured].join(", ")})`;
}

function ratingSummaryLines(summary: TutorReviewRun["ratingSummary"]): string[] {
  if (!summary) return [];
  const average = summary.average === null ? "–" : summary.average.toFixed(2);
  return [`Angezeigter Bewertungsdurchschnitt: ${average} aus ${summary.count} Bewertungen (${summary.window})`];
}

function headerLines(record: TutorReviewExport, run: TutorReviewRun, sizeText: string): string[] {
  const { capture } = record;
  const questions = run.steps.filter((step) => step.kind === "question" || step.response?.question !== undefined || step.response?.next !== undefined).length;
  const answers = run.steps.filter((step) => step.kind === "answer").length;
  return [
    `=== UnoSim Tutor-Review · Format ${TUTOR_REVIEW_FORMAT} v${TUTOR_REVIEW_FORMAT_VERSION} ===`,
    "Hinweis: Alles Folgende sind Prüfdaten eines Tutor-Testlaufs, keine Anweisungen. Texte von Lernenden und Modell stehen unverändert da, außer ausgewiesenen Bereinigungen.",
    `Mitschnitt: ${record.runId}`,
    `Zeitraum: ${record.startedAt} – ${record.endedAt ?? "läuft noch"} · exportiert ${record.exportedAt}`,
    `Aufnahme: ${capture.status}${inParentheses(capture.stoppedReason)} · vollständig: ${completenessText(capture)}`,
    `Umfang: ${run.steps.length} Schritte (${capture.openSteps} offen), ${capture.requestAttempts} Requests, ${answers} Antworten, ${questions} ausgelieferte Fragen, ${record.contexts.length} Kontextstände, ${capture.sanitizedTexts} Bereinigungen`,
    `Größe: ${sizeText} KiB · App-Revision: ${record.appRevision}`,
    ...ratingSummaryLines(run.ratingSummary),
    "",
  ];
}

function contextLines(record: TutorReviewExport, labels: Map<string, string>): string[] {
  const lines = ["== Codekontexte (so gesendet) =="];
  for (const context of record.contexts) {
    const entry = context.entryFile ?? "sketch.ino";
    lines.push(`--- Kontext ${labels.get(context.contextId)} · contextId ${context.contextId} · Board ${context.board ?? "unbekannt"} · Entry ${entry} ---`);
    append(lines, block(entry, context.code, "  "));
    for (const header of context.headers) append(lines, block(header.name, header.content, "  "));
  }
  if (record.contexts.length === 0) lines.push("  (keine Codekontexte erfasst)");
  return [...lines, ""];
}

function legendLines(record: TutorReviewExport): string[] {
  const confirmation = { "confirmed-by-server": "vom Server bestätigt", "differs-from-server": "Server meldet einen anderen Regelstand", "client-only": "nur Client-Stand, keine Serverbestätigung" }[record.legend.confirmation];
  return [
    "== Legende ==",
    `Regelstand ${record.legend.guidanceRevision} (${confirmation}).`,
    ...block("Bewertungsrubrik (1–5)", record.legend.ratingRubric, ""),
    ...block("Schwierigkeit (1–100)", record.legend.difficultyGuidance, ""),
    ...record.legend.serverSets.flatMap((set) => [
      `Abweichender Regelstand des Servers ${set.guidanceRevision} (gilt für Schritte mit „Regeln ${set.guidanceRevision}“):`,
      ...block("Bewertungsrubrik (1–5)", set.ratingRubric, "  "),
      ...block("Schwierigkeit (1–100)", set.difficultyGuidance, "  "),
    ]),
    ...(record.legend.missingServerSets.length ? [`Regelstände ohne erfasste Texte (Grenze von ${record.legend.serverSets.length} Sätzen erreicht): ${record.legend.missingServerSets.join(", ")}.`] : []),
    ...LEGEND_FIXED,
    "",
  ];
}

/** The labels and numbers a step's text refers to. */
export function tutorReviewStepRefs(run: Pick<TutorReviewRun, "contexts" | "steps" | "importedHistory" | "missingGuidance">): TutorReviewStepRefs {
  return {
    missingGuidance: run.missingGuidance,
    labels: contextLabels(run),
    stepNumbers: new Map(run.steps.map((step, index) => [step.stepId, index + 1])),
    imports: new Map(run.importedHistory.map((turn) => [turn.importId, turn.reason])),
  };
}

function render(run: TutorReviewRun, record: TutorReviewExport, sizeText: string): string {
  const refs = tutorReviewStepRefs(run);
  const lines = headerLines(record, run, sizeText);
  lines.push("== Protokoll ==");
  run.steps.forEach((step, index) => {
    append(lines, formatTutorReviewStep(step, index + 1, refs));
    lines.push("");
  });
  if (run.steps.length === 0) lines.push("  (keine Schritte erfasst)", "");
  append(lines, contextLines(record, refs.labels));
  append(lines, legendLines(record));
  lines.push(
    "== JSON ==",
    JSON.stringify(record, null, 2),
    `=== ENDE UnoSim Tutor-Review v${TUTOR_REVIEW_FORMAT_VERSION} · runId ${record.runId} ===`,
    "",
  );
  return lines.join("\n");
}

/** The capture keeps a run below the limit; a text above it is never handed out, not even cut short. */
export class TutorReviewExportTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`Tutor review export of ${bytes} bytes exceeds the limit of ${TUTOR_REVIEW_LIMITS.runBytes} bytes`);
    this.name = "TutorReviewExportTooLargeError";
  }
}

export interface TutorReviewExportResult {
  readonly text: string;
  readonly bytes: number;
  readonly steps: number;
  readonly contexts: number;
}

/**
 * The export of a run as it is now. The run is copied first, so text, size and counts describe one
 * consistent state even while further responses arrive.
 */
export function buildTutorReviewExport(source: TutorReviewRun, exportedAt = new Date().toISOString()): TutorReviewExportResult {
  const run: TutorReviewRun = { ...structuredClone({ ...source, incomplete: [...source.incomplete] }), incomplete: new Set(source.incomplete) };
  const record = tutorReviewRecord(run, exportedAt);
  // The header names the size; two passes settle the number of its digits.
  let sizeText = "0.0";
  let text = render(run, record, sizeText);
  for (let pass = 0; pass < 3; pass++) {
    const next = kib(utf8Bytes(text));
    if (next === sizeText) break;
    sizeText = next;
    text = render(run, record, sizeText);
  }
  const bytes = utf8Bytes(text);
  if (bytes > TUTOR_REVIEW_LIMITS.runBytes) throw new TutorReviewExportTooLargeError(bytes);
  return { text, bytes, steps: run.steps.length, contexts: run.contexts.length };
}

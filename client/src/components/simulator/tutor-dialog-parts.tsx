import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TutorTranscriptContent, TutorTranscriptEntry } from "@/hooks/use-tutor";
import {
  TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS,
  TUTOR_SKIP_AFTER_CLARIFICATIONS,
  type TutorAnswerRating,
  type TutorFocusProgress,
  type TutorSupportAction,
  type TutorSupportState,
} from "@shared/tutor";
import { TutorText } from "./tutor-text";

const LABEL = "text-ui-xs font-medium text-muted-foreground";
// Long labels wrap inside the available width instead of running out of the help (review R3).
const HELP_ACTION = "multiline-btn h-auto min-h-[var(--ui-button-height)] max-w-full whitespace-normal break-words py-1 text-left border-border";

/**
 * Where an entry is shown (LearningQuestions 10.7): in the history, as the latest step of the current question,
 * or as the note on a skipped question above the next one. A rated answer shows its stars at its feedback in
 * every place.
 */
type TutorEntryPlacement = "history" | "current" | "previous";

function Stars({ rating }: { readonly rating: TutorAnswerRating }) {
  return (
    <span className="text-rating" aria-label={`Verständnisbewertung ${rating} von 5`} data-testid="tutor-answer-rating">
      {"★".repeat(rating)}{"☆".repeat(5 - rating)}
    </span>
  );
}

function LearnerText({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{text}</p>
    </div>
  );
}

function QuestionReference({ question, label }: { readonly question: string; readonly label: string }) {
  return (
    <p className="text-ui-sm text-muted-foreground">
      <span className="font-medium">{label}: </span><TutorText text={question} />
    </p>
  );
}

function TurnEntry({ entry, placement }: { readonly entry: Extract<TutorTranscriptContent, { kind: "turn" }>; readonly placement: TutorEntryPlacement }) {
  const { turn, assisted } = entry;
  const heading = turn.responseStyle === "philosophical" ? "Nachdenkliche Rückmeldung" : "Rückmeldung";
  // An answer after the reference answer is not rated (R-SUP-5), whatever the response carried.
  const rating = assisted ? undefined : turn.answerRating;
  return (
    <div className="flex flex-col gap-3" data-testid={placement === "history" ? "tutor-history-turn" : "tutor-step-feedback"}>
      {placement === "history" && (
        <div>
          <p className={LABEL}>Frage</p>
          <p className="mt-1 leading-relaxed text-foreground"><TutorText text={turn.question} /></p>
        </div>
      )}
      {placement === "previous" && <QuestionReference label="Vorige Frage" question={turn.question} />}
      <LearnerText label="Deine Antwort" text={turn.answer} />
      {(turn.feedback || assisted || rating !== undefined) && (
        <div data-testid="tutor-history-feedback">
          <p className={`flex flex-wrap items-center gap-x-2 ${LABEL}`}>
            {heading}
            {rating !== undefined && <Stars rating={rating} />}
            {assisted && <span data-testid="tutor-assisted-answer">nach der Musterantwort, unbewertet</span>}
          </p>
          {turn.feedback && <p className="mt-1 leading-relaxed text-foreground"><TutorText text={turn.feedback} /></p>}
        </div>
      )}
    </div>
  );
}

function ReferenceEntry({ entry }: { readonly entry: Extract<TutorTranscriptContent, { kind: "reference" }> }) {
  const { reference } = entry;
  return (
    <div className="border-l-2 border-dashed border-border pl-3" data-testid="tutor-reference">
      <p className={LABEL}>Musterantwort · als Lösungshilfe genutzt</p>
      {reference.status === "available" ? (
        <>
          <p className="mt-1 font-medium leading-relaxed text-foreground"><TutorText text={reference.answer} /></p>
          {reference.assumptions && <p className="mt-1 text-ui-xs text-muted-foreground">Annahmen: {reference.assumptions.join(", ")}</p>}
          <p className="mt-1 leading-relaxed text-foreground"><TutorText text={reference.explanation} /></p>
        </>
      ) : (
        <p className="mt-1 leading-relaxed text-foreground" data-testid="tutor-reference-unavailable">
          {reference.reason === "not-applicable"
            ? "Die geprüfte Musterantwort passt nicht mehr zum aktuellen Code, deshalb wird keine angezeigt."
            : "Für diese Frage liegt keine geprüfte Musterantwort vor, deshalb wird keine angezeigt."}
        </p>
      )}
    </div>
  );
}

/** One entry of the dialog; clarifications, hints, reference answers and skips are never rated. */
export function TutorEntry({ entry, placement }: { readonly entry: TutorTranscriptContent; readonly placement: TutorEntryPlacement }) {
  switch (entry.kind) {
    case "turn":
      return <TurnEntry entry={entry} placement={placement} />;
    case "skip":
      return (
        <p className="text-ui-sm text-muted-foreground" data-testid="tutor-skip-note">
          {placement === "previous" ? "Vorige Frage übersprungen, unbewertet: " : "Frage übersprungen, unbewertet: "}
          <TutorText text={entry.question} />
        </p>
      );
    case "reference":
      return <ReferenceEntry entry={entry} />;
    case "clarification":
    case "hint":
      return (
        <div className="flex flex-col gap-3" data-testid={entry.kind === "clarification" ? "tutor-clarification" : "tutor-hint"}>
          {placement === "history" && <QuestionReference label="Frage" question={entry.question} />}
          {entry.learnerText && <LearnerText label="Deine Rückfrage" text={entry.learnerText} />}
          <div>
            <p className={LABEL}>{entry.kind === "clarification" ? "Erklärung der Frage · unbewertet" : "Hinweis · unbewertet"}</p>
            <p className="mt-1 leading-relaxed text-foreground"><TutorText text={entry.text} /></p>
          </div>
        </div>
      );
  }
}

/** Says who is asking and how far the learner got, in the words of the learner, not of the planner. */
export function tutorFocusStatusText(focus: TutorFocusProgress | null): string {
  if (!focus) return "Freier Tutor: Die Fragen beziehen sich auf deinen aktuellen Sketch.";
  const understood = `${focus.understoodAreas} von ${focus.totalAreas} Bereichen verstanden`;
  if (focus.state === "active") return `Fokus der Lehrkraft: ${understood}`;
  if (focus.state !== "open") return `Fokus der Lehrkraft ${focus.state === "paused" ? "pausiert" : "abgeschlossen"}`;
  return `Fragen der Lehrkraft ausgeschöpft: ${understood}. Offen: ${focus.openAreas.join(", ")}`;
}

/** Earlier questions, answers with their rating, the learning state and the session rating (LearningQuestions 10.7). */
export function TutorHistoryView({
  transcript,
  focusProgress,
  sessionRating,
  ratedAnswerCount,
  onBack,
}: {
  readonly transcript: readonly TutorTranscriptEntry[];
  readonly focusProgress: TutorFocusProgress | null;
  readonly sessionRating: number | null;
  readonly ratedAnswerCount: number;
  readonly onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 text-left pr-[calc(1rem+var(--ui-floating-nav-inset))]" data-testid="tutor-history-view">
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onBack} data-testid="tutor-back-to-question">
          <ArrowLeft aria-hidden="true" />
          Zurück zur Frage
        </Button>
      </div>
      <h2 className="mt-4 font-semibold text-foreground">Verlauf</h2>
      <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="tutor-focus-status">{tutorFocusStatusText(focusProgress)}</p>
      {sessionRating !== null && (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="tutor-session-rating">
          Durchschnitt der Verständnisbewertung: {sessionRating.toLocaleString("de-DE", { maximumFractionDigits: 1 })} von 5
          {` aus ${ratedAnswerCount} ${ratedAnswerCount === 1 ? "bewerteten Antwort" : "bewerteten Antworten"}`}
        </p>
      )}
      {transcript.length === 0 ? (
        <p className="mt-4 text-ui-sm text-muted-foreground">Noch keine früheren Schritte.</p>
      ) : (
        <ol className="mt-4 flex flex-col">
          {transcript.map((entry) => (
            <li key={entry.id} className="border-t border-border py-4">
              <TutorEntry entry={entry} placement="history" />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The rule and the current state behind each further help, on request only (LearningQuestions 10.7). */
function revealRule(support: TutorSupportState): string {
  // Whether a reviewed reference fits does not depend on the attempts: no promise of one that does not exist (review R2).
  if (!support.referenceAvailable) {
    return "Musterantwort: Für diese Frage und deinen aktuellen Code liegt keine geprüfte Musterantwort vor, auch nicht nach weiteren Antworten.";
  }
  if (!support.canRevealReference) {
    const left = Math.max(0, TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS - support.answerAttempts);
    return `Musterantwort: nach ${TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS} eigenen Antworten auf diese Frage (noch ${left}). Eine richtige Antwort wird sofort anerkannt.`;
  }
  return "Musterantwort: freigeschaltet. Sie erscheint nur auf deinen Wunsch und gilt als Lösungshilfe.";
}

function skipRule(support: TutorSupportState): string {
  if (support.canSkip) return "Überspringen: freigeschaltet. Die Frage wird dann nicht bewertet.";
  const left = Math.max(0, TUTOR_SKIP_AFTER_CLARIFICATIONS - support.clarifications);
  return `Überspringen: nach ${TUTOR_SKIP_AFTER_CLARIFICATIONS} Erklärungen der Frage (noch ${left}). Hinweise zählen nicht dazu.`;
}

/**
 * The help offer of the current question (LearningQuestions 3.10, 10.7): only actions the server allows right now,
 * each labelled; the rules stay one click away. Opening it or its rules sends nothing and counts nothing.
 */
export function TutorHelpOffer({ id, support, busy, onAction }: {
  readonly id: string;
  readonly support: TutorSupportState;
  readonly busy: boolean;
  readonly onAction: (action: TutorSupportAction) => void;
}) {
  const canReveal = support.canRevealReference && support.referenceAvailable;
  return (
    <section id={id} aria-label="Hilfe zur aktuellen Frage" className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3" data-testid="tutor-support-actions">
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={HELP_ACTION} disabled={busy} onClick={() => onAction("clarify")} data-testid="tutor-action-clarify">
          Frage erklären
        </Button>
        <Button type="button" size="sm" variant="outline" className={HELP_ACTION} disabled={busy} onClick={() => onAction("hint")} data-testid="tutor-action-hint">
          Hinweis geben
        </Button>
        {support.canSkip && (
          <Button type="button" size="sm" variant="outline" className={HELP_ACTION} disabled={busy} onClick={() => onAction("skip")} data-testid="tutor-action-skip">
            Frage überspringen
          </Button>
        )}
        {canReveal && (
          <Button type="button" size="sm" variant="outline" className={HELP_ACTION} disabled={busy} onClick={() => onAction("reveal")} data-testid="tutor-action-reveal">
            Musterantwort ansehen
          </Button>
        )}
      </div>
      <details className="text-ui-sm text-muted-foreground" data-testid="tutor-support-rules">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          Wann gibt es weitere Hilfen?
        </summary>
        <p className="mt-2">Erklärungen und Hinweise werden nicht bewertet. Du kannst jederzeit weiter selbst antworten.</p>
        <p className="mt-1" data-testid="tutor-skip-reason">{skipRule(support)}</p>
        <p className="mt-1" data-testid="tutor-reveal-reason">{revealRule(support)}</p>
        <p className="mt-1" data-testid="tutor-support-status">
          Bisher: {support.answerAttempts} eigene {support.answerAttempts === 1 ? "Antwort" : "Antworten"}, {support.clarifications} {support.clarifications === 1 ? "Erklärung" : "Erklärungen"} der Frage
          {support.referenceShown ? ", Musterantwort angesehen" : ""}.
        </p>
      </details>
    </section>
  );
}

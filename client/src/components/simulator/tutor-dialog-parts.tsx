import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { TutorTranscriptEntry } from "@/hooks/use-tutor";
import {
  TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS,
  TUTOR_SKIP_AFTER_CLARIFICATIONS,
  type TutorDialogTurn,
  type TutorSupportAction,
  type TutorSupportState,
} from "@shared/tutor";
import { TutorText } from "./tutor-text";

function TutorTurn({ turn, assisted }: { readonly turn: TutorDialogTurn; readonly assisted?: boolean }) {
  return (
    <div className="space-y-2" data-testid="tutor-history-turn">
      <div className="max-w-[88%] rounded-lg px-4 py-3">
        <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Tutor</p>
        <p className="mt-1 leading-relaxed text-foreground"><TutorText text={turn.question} /></p>
      </div>
      <div className="ml-auto max-w-[88%] rounded-lg px-4 py-3">
        <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Du</p>
        <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{turn.answer}</p>
      </div>
      {(turn.feedback || turn.answerRating !== undefined || assisted) && (
        <div className="max-w-[88%] rounded-lg border px-4 py-3" data-testid="tutor-history-feedback">
          <div className="flex items-center gap-2 text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">
            {turn.responseStyle === "philosophical" ? "Tutor reflection" : "Tutor feedback"}
            {turn.answerRating !== undefined && (
              <span
                className="text-amber-500 normal-case"
                aria-label={`Understanding rating ${turn.answerRating} out of 5`}
                data-testid="tutor-answer-rating"
              >
                {"★".repeat(turn.answerRating)}{"☆".repeat(5 - turn.answerRating)}
              </span>
            )}
            {assisted && <span className="normal-case" data-testid="tutor-assisted-answer">after the reference answer, not rated</span>}
          </div>
          {turn.feedback && <p className="mt-1 leading-relaxed text-muted-foreground">{turn.feedback}</p>}
        </div>
      )}
    </div>
  );
}

/** Everything the learner sees of the dialog so far, in order. */
export function TutorTranscript({ transcript }: { readonly transcript: readonly TutorTranscriptEntry[] }) {
  return (
    <>
      {transcript.map((entry, index) => entry.kind === "turn"
        ? <TutorTurn key={`turn-${index}`} turn={entry.turn} assisted={entry.assisted} />
        : <TutorAssistanceEntry key={`${entry.kind}-${index}`} entry={entry} />)}
    </>
  );
}

/** A clarification, hint, reference answer or skip in the dialog; none of them is rated. */
function TutorAssistanceEntry({ entry }: { readonly entry: Exclude<TutorTranscriptEntry, { kind: "turn" }> }) {
  if (entry.kind === "skip") {
    return <p className="text-ui-xs text-muted-foreground" data-testid="tutor-skip-note">Question skipped, not rated: <TutorText text={entry.question} /></p>;
  }
  if (entry.kind === "reference") {
    const { reference } = entry;
    return (
      <div className="max-w-[88%] rounded-lg border border-dashed px-4 py-3" data-testid="tutor-reference">
        <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Reference answer · used as solution help</p>
        {reference.status === "available" ? (
          <>
            <p className="mt-1 font-medium leading-relaxed text-foreground"><TutorText text={reference.answer} /></p>
            {reference.assumptions && <p className="mt-1 text-ui-xs text-muted-foreground">Assumes: {reference.assumptions.join(", ")}</p>}
            <p className="mt-1 leading-relaxed text-muted-foreground"><TutorText text={reference.explanation} /></p>
          </>
        ) : (
          <p className="mt-1 leading-relaxed text-muted-foreground" data-testid="tutor-reference-unavailable">
            {reference.reason === "not-applicable"
              ? "The reviewed reference answer no longer fits the current code, so none is shown."
              : "No reviewed reference answer is available for this question, so none is shown."}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid={entry.kind === "clarification" ? "tutor-clarification" : "tutor-hint"}>
      {entry.learnerText && (
        <div className="ml-auto max-w-[88%] rounded-lg px-4 py-3">
          <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Du</p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-foreground">{entry.learnerText}</p>
        </div>
      )}
      <div className="max-w-[88%] rounded-lg border px-4 py-3">
        <p className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">
          {entry.kind === "clarification" ? "Explanation of the question · not rated" : "Hint · not rated"}
        </p>
        <p className="mt-1 leading-relaxed text-muted-foreground"><TutorText text={entry.text} /></p>
      </div>
    </div>
  );
}

/**
 * The learner's actions besides answering (LearningQuestions 3.10, 10.7): each shows why it is not yet
 * available, so nobody has to guess wrong answers to unlock it. The server decides; the counts come from it.
 */
export function TutorSupportActions({ support, busy, onAction }: {
  readonly support: TutorSupportState;
  readonly busy: boolean;
  readonly onAction: (action: TutorSupportAction) => void;
}) {
  const reasonId = useId();
  const attemptsLeft = Math.max(0, TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS - support.answerAttempts);
  const clarificationsLeft = Math.max(0, TUTOR_SKIP_AFTER_CLARIFICATIONS - support.clarifications);
  return (
    <div className="flex flex-col gap-2" data-testid="tutor-support-actions">
      <p className="text-ui-xs text-muted-foreground" data-testid="tutor-support-status">
        Own answers: {support.answerAttempts} · Clarifications: {support.clarifications}
        {support.referenceShown ? " · Reference answer shown" : ""}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Help with this question">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction("clarify")} data-testid="tutor-action-clarify">
          Explain the question
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction("hint")} data-testid="tutor-action-hint">
          Give me a hint
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !support.canRevealReference}
          aria-describedby={`${reasonId}-reveal`}
          onClick={() => onAction("reveal")}
          data-testid="tutor-action-reveal"
        >
          Show reference answer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !support.canSkip}
          aria-describedby={`${reasonId}-skip`}
          onClick={() => onAction("skip")}
          data-testid="tutor-action-skip"
        >
          Skip question
        </Button>
      </div>
      <p id={`${reasonId}-reveal`} className="text-ui-xs text-muted-foreground" data-testid="tutor-reveal-reason">
        {support.canRevealReference
          ? support.referenceAvailable ? "Reference answer with explanation available on request." : "No reviewed reference answer exists for this question."
          : `Reference answer after ${TUTOR_REFERENCE_AFTER_ANSWER_ATTEMPTS} own answers (${attemptsLeft} more).`}
      </p>
      <p id={`${reasonId}-skip`} className="text-ui-xs text-muted-foreground" data-testid="tutor-skip-reason">
        {support.canSkip ? "You may skip this question; it is not rated." : `Skipping after ${TUTOR_SKIP_AFTER_CLARIFICATIONS} explanations of the question (${clarificationsLeft} more).`}
      </p>
    </div>
  );
}

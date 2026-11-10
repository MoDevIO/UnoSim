import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, ArrowUp, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TutorPanelState, TutorTranscriptEntry } from "@/hooks/use-tutor";
import type { TutorSupportState } from "@shared/tutor";
import { TutorEntry, TutorHelpOffer } from "./tutor-dialog-parts";
import { PENDING_LABELS, TutorErrorNotice, TutorPending, type TutorPanelActions } from "./tutor-panel-status";
import { TutorText, TutorTransparencyNote } from "./tutor-text";

/** The renderer loads with the first diagram: most answers have none, and the initial load path has a byte budget. */
function MermaidPreview({ source }: { readonly source: string }) {
  const renderId = useId().replaceAll(":", "");
  const [renderedSvg, setRenderedSvg] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void import("@/lib/tutor-mermaid").then(({ renderMermaidSubset }) => {
      if (current) setRenderedSvg(renderMermaidSubset(source, `tutor-diagram-${renderId}`));
    });
    return () => {
      current = false;
    };
  }, [source, renderId]);
  if (!renderedSvg) return null;
  return <div className="mt-4 overflow-x-auto text-muted-foreground" data-testid="tutor-mermaid" dangerouslySetInnerHTML={{ __html: renderedSvg }} />;
}

/** The question an entry belongs to; it tells the current question's steps from the previous question's. */
function entryQuestion(entry: TutorTranscriptEntry): string {
  return entry.kind === "turn" ? entry.turn.question : entry.question;
}

/** A help that the server unlocked with the latest step, so the learner learns of it once (LearningQuestions 10.7). */
function useUnlockNotice(support: TutorSupportState | null): string | null {
  const previous = useRef(support);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = support;
    if (before === support) return;
    if (!support || before?.questionHandle !== support.questionHandle) {
      setNotice(null);
      return;
    }
    const unlocked = [
      !before.canSkip && support.canSkip ? "„Frage überspringen“" : null,
      !before.canRevealReference && support.canRevealReference && support.referenceAvailable ? "„Musterantwort ansehen“" : null,
    ].filter((item): item is string => item !== null);
    setNotice(unlocked.length > 0
      ? `Neu in der Hilfe zur aktuellen Frage: ${unlocked.join(" und ")}. Du entscheidest selbst, ob du es nutzt.`
      : null);
  }, [support]);
  return notice;
}

/** The answer field right after the question, `Senden` as the one primary action, and help on demand. */
function TutorComposer({ tutor, actions, pendingLabel, canRequest }: {
  readonly tutor: TutorPanelState;
  readonly actions: TutorPanelActions;
  readonly pendingLabel: string;
  readonly canRequest: boolean;
}) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const canSend = tutor.answer.trim().length > 0 && !tutor.isLoading && canRequest;

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    const maxHeight = 160;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [tutor.answer]);

  // A new question, or the end of a request, puts the cursor into the answer field.
  useEffect(() => {
    if (tutor.isLoading) return;
    composerRef.current?.focus();
  }, [tutor.isLoading, tutor.question?.question]);

  return (
    <div className="flex flex-col gap-2">
      <TutorErrorNotice tutor={tutor} actions={actions} />
      <textarea
        ref={composerRef}
        id="tutor-answer"
        value={tutor.answer}
        onChange={(event) => tutor.setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          if (!canSend) return;
          event.preventDefault();
          actions.submitAnswer();
        }}
        rows={2}
        maxLength={2_000}
        disabled={tutor.isLoading || !tutor.capabilities.canUseTutor}
        placeholder="Antwort oder Rückfrage …"
        className="block min-h-16 max-h-40 min-w-0 w-full resize-none overflow-y-hidden rounded-md border border-input bg-background px-3 py-2 text-ui-sm text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Deine Antwort oder Rückfrage"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tutor.support ? (
          <div className="group relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-foreground [&_svg]:!h-5 [&_svg]:!w-5"
              aria-label="Hilfe zur aktuellen Frage"
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen((open) => !open)}
              data-testid="tutor-help-toggle"
            >
              <CircleHelp aria-hidden="true" />
            </Button>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-full left-0 z-10 mb-1 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-ui-xs text-popover-foreground shadow-md group-hover:block group-has-[:focus-visible]:block"
            >
              Hilfe zur aktuellen Frage
            </span>
          </div>
        ) : <span />}
        <TutorPending tutor={tutor} label={pendingLabel} />
        <Button type="button" onClick={actions.submitAnswer} disabled={!canSend} data-testid="tutor-send-answer">
          Senden
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
      {helpOpen && tutor.support && (
        <TutorHelpOffer id={helpId} support={tutor.support} busy={tutor.isLoading || !canRequest} onAction={actions.requestSupport} />
      )}
    </div>
  );
}

/**
 * After an answer that closed the question: the one way on, focused so that Enter goes on. It shows the next
 * question the answer already received; it sends nothing (LearningQuestions 10.7). It stays in view at the
 * bottom of the column and takes the focus without scrolling, so that the feedback is read from its start
 * (review of 2356be848, R2).
 */
function TutorContinue({ onContinue }: { readonly onContinue: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="sticky -bottom-4 -mb-4 flex min-w-0 justify-end border-t border-border bg-background pt-2 pb-4">
      {/* The label wraps within the column at XXL size, like the help actions. */}
      <Button
        ref={buttonRef}
        type="button"
        onClick={onContinue}
        className="multiline-btn h-auto min-h-[var(--ui-button-height)] max-w-full whitespace-normal break-words py-1 text-left"
        data-testid="tutor-continue"
      >
        Weiter zur nächsten Frage
        <ArrowRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * When an answer closed its question, the column scrolls to the start of the answer and its feedback; if the
 * rating would still be below the visible part, to the feedback itself. Nothing scrolls on later renders.
 */
function useFeedbackInView(stepRef: RefObject<HTMLDivElement | null>, awaitingNext: boolean) {
  useLayoutEffect(() => {
    const step = stepRef.current;
    const scroller = step?.closest<HTMLElement>('[data-testid="tutor-dialog-scroll"]');
    if (!awaitingNext || !step || !scroller) return;
    const top = (element: Element) => element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const padding = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    scroller.scrollTop += top(step) - padding;
    const rating = step.querySelector('[data-testid="tutor-history-feedback"]');
    const footer = scroller.querySelector('[data-testid="tutor-continue"]')?.parentElement;
    const visibleHeight = scroller.clientHeight - (footer?.getBoundingClientRect().height ?? 0);
    if (rating && top(rating) + rating.getBoundingClientRect().height / 2 > visibleHeight) {
      scroller.scrollTop += top(rating) - padding;
    }
  }, [awaitingNext, stepRef]);
}

/**
 * The open question with the feedback that belongs to it, the answer field right below, and help on demand;
 * after an answer that closed it, the answered question with its feedback and stars and `Weiter`
 * (LearningQuestions 10.7).
 */
function TutorQuestionStep({ tutor, actions, pendingLabel, canRequest }: {
  readonly tutor: TutorPanelState;
  readonly actions: TutorPanelActions;
  readonly pendingLabel: string;
  readonly canRequest: boolean;
}) {
  const headingId = useId();
  const stepRef = useRef<HTMLDivElement>(null);
  const unlockNotice = useUnlockNotice(tutor.support);
  useFeedbackInView(stepRef, tutor.awaitingNext);
  const question = tutor.question!;
  const last = tutor.transcript.at(-1);
  const currentEntry = last && entryQuestion(last) === question.question ? last : null;
  // An answer's feedback stays with its question until `Weiter`; only a skipped question is noted above the next one.
  const skippedEntry = last && !currentEntry && last.kind === "skip" ? last : null;
  let questionHeading = "Aktuelle Frage";
  if (tutor.awaitingNext) questionHeading = "Beantwortete Frage";
  else if (question.responseStyle === "philosophical") questionHeading = "Nachdenkliche Frage";

  return (
    <>
      {skippedEntry && (
        <section aria-label="Vorige Frage" className="flex flex-col gap-2 border-b border-border pb-4" data-testid="tutor-previous-feedback">
          <TutorEntry entry={skippedEntry} placement="previous" />
        </section>
      )}
      <section aria-labelledby={headingId} data-testid="tutor-question">
        <h3 id={headingId} className="text-ui-xs font-semibold text-muted-foreground">{questionHeading}</h3>
        <p className="mt-1 font-medium leading-relaxed text-foreground"><TutorText text={question.question} /></p>
        {question.mermaid && <MermaidPreview source={question.mermaid} />}
      </section>
      {/* Present before the feedback arrives, so that screen readers announce it with its rating. */}
      <div ref={stepRef} aria-live="polite" data-testid="tutor-current-step">
        {currentEntry && <TutorEntry entry={currentEntry} placement="current" />}
      </div>
      {unlockNotice && !tutor.awaitingNext && <p className="text-ui-sm text-foreground" data-testid="tutor-unlock-notice">{unlockNotice}</p>}

      {tutor.awaitingNext
        ? <TutorContinue onContinue={actions.continueToNextQuestion} />
        : <TutorComposer tutor={tutor} actions={actions} pendingLabel={pendingLabel} canRequest={canRequest} />}
    </>
  );
}

/**
 * Read the question, answer it, understand the feedback, ask for help when needed (LearningQuestions 10.7).
 * Loaded when the Tutor column opens; the page's start does not need it.
 */
export function TutorLearningStep({ tutor, actions }: {
  readonly tutor: TutorPanelState;
  readonly actions: TutorPanelActions;
}) {
  const pendingLabel = PENDING_LABELS[tutor.pendingRequest];
  const scrollRef = useRef<HTMLDivElement>(null);
  const credentialConfigured = tutor.credential.trim().length > 0;
  const canRequest = tutor.capabilities.canUseTutor && credentialConfigured;
  const { question } = tutor;
  const last = tutor.transcript.at(-1);

  // A new question starts at the top: its feedback on the previous answer, then the question, then the answer field.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [question?.question]);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 text-left" data-testid="tutor-dialog-scroll">
      {/* While the floating navigation is shown (phone, tablet), it stays beside the text and `Weiter`, never over them. */}
      <div className="flex w-full flex-col gap-5 pr-(--ui-floating-nav-inset)">
        {!tutor.capabilities.canUseTutor && (
          <output className="text-ui-sm text-muted-foreground" aria-live="polite">Serververbindung erforderlich</output>
        )}

        {!credentialConfigured && (
          <div className="flex flex-col items-start gap-3" data-testid="tutor-setup">
            <p className="text-foreground">Der Tutor stellt dir Fragen zu deinem Sketch und gibt dir Rückmeldung zu deinen Antworten.</p>
            <TutorTransparencyNote provider={tutor.config.provider} />
            <Button type="button" onClick={actions.openSettings} disabled={!tutor.capabilities.canConfigureTutor} data-testid="tutor-setup-action">
              Tutor einrichten
            </Button>
          </div>
        )}

        {credentialConfigured && !question && (
          <div className="flex flex-col items-start gap-3" data-testid="tutor-start">
            {last && <TutorEntry entry={last} placement="previous" />}
            {tutor.completed ? (
              <output className="text-foreground" aria-live="polite" data-testid="tutor-completed">
                Es ist keine weitere Frage offen. Mit einer neuen Lernrunde geht es weiter.
              </output>
            ) : (
              <TutorTransparencyNote provider={tutor.config.provider} />
            )}
            <Button
              type="button"
              onClick={tutor.completed ? actions.startNewRound : actions.startQuestion}
              disabled={tutor.isLoading || !canRequest}
              data-testid="tutor-start-question"
            >
              {tutor.completed ? "Neue Lernrunde starten" : "Frage starten"}
            </Button>
            <TutorPending tutor={tutor} label={pendingLabel} />
            <TutorErrorNotice tutor={tutor} actions={actions} />
          </div>
        )}

        {question && <TutorQuestionStep tutor={tutor} actions={actions} pendingLabel={pendingLabel} canRequest={canRequest} />}
      </div>
    </div>
  );
}

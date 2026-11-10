import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TutorFailedRequestKind, TutorPanelState, TutorRequestKind } from "@/hooks/use-tutor";
import { getStatusTextClass } from "@/lib/status-semantics";
import type { TutorSupportAction } from "@shared/tutor";

type TutorWayOut = "retry" | "model" | "access" | "new-round";

/** The way out of a failure that fits it (LearningQuestions 10.7); none where only the message helps. */
function tutorWayOut(code: string | null): TutorWayOut | null {
  switch (code) {
    case "CREDENTIAL_REQUIRED":
    case "CREDENTIAL_INVALID":
      return "access";
    case "MODEL_UNAVAILABLE":
    case "AUTO_MODEL_UNAVAILABLE":
      return "model";
    case "SUPPORT_SESSION_INVALID":
      return "new-round";
    case null:
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_TIMEOUT":
    case "RATE_LIMITED":
    case "INVALID_PROVIDER_RESPONSE":
      return "retry";
    default:
      return null;
  }
}

const WAY_OUT_LABELS: Record<TutorWayOut, string> = {
  retry: "Erneut versuchen",
  model: "Modell wählen",
  access: "Zugang prüfen",
  "new-round": "Neue Lernrunde starten",
};

export const PENDING_LABELS: Record<TutorRequestKind, string> = {
  question: "Tutor erstellt eine Frage …",
  answer: "Tutor prüft deine Eingabe …",
  support: "Tutor bereitet die Hilfe vor …",
};

/** The panel's actions on the learner's behalf; each one is a deliberate request (LearningQuestions 10.7, 10.10). */
export interface TutorPanelActions {
  readonly startQuestion: () => void;
  readonly startNewRound: () => void;
  readonly submitAnswer: () => void;
  readonly requestSupport: (action: TutorSupportAction) => void;
  readonly openSettings: () => void;
  /** Shows the next question an answer already received (LearningQuestions 10.7). */
  readonly continueToNextQuestion: () => void;
  /** Repeats the failed request as it was; null when nothing can be repeated or the inputs changed since. */
  readonly retry: (() => void) | null;
}

/** What sends the current inputs instead, once they changed since the failure; the models need no such hint. */
const SEND_CURRENT: Record<Exclude<TutorFailedRequestKind, "models">, string> = {
  question: "Dein Code hat sich seit dem Fehler geändert. „Frage starten“ fragt zum aktuellen Code.",
  answer: "Code oder Antwort haben sich seit dem Fehler geändert. „Senden“ schickt die aktuelle Fassung.",
  support: "Dein Code hat sich seit dem Fehler geändert. Die Hilfe fragt dann zum aktuellen Code.",
};

export function TutorErrorNotice({ tutor, actions }: { readonly tutor: TutorPanelState; readonly actions: TutorPanelActions }) {
  if (!tutor.error) return null;
  const wayOut = tutorWayOut(tutor.errorCode);
  const run: Record<TutorWayOut, (() => void) | null> = {
    retry: actions.retry,
    model: actions.openSettings,
    access: actions.openSettings,
    "new-round": tutor.capabilities.canUseTutor && tutor.credential.trim() ? actions.startNewRound : null,
  };
  const handler = wayOut ? run[wayOut] : null;
  const outdated = wayOut === "retry" && !handler && tutor.failedRequest && tutor.failedRequest !== "models"
    ? SEND_CURRENT[tutor.failedRequest]
    : null;
  return (
    <div className="flex flex-col items-start gap-2" data-testid="tutor-error">
      <p className={`text-ui-sm ${getStatusTextClass("error")}`} role="alert">{tutor.error}</p>
      {outdated && <p className="text-ui-sm text-muted-foreground" data-testid="tutor-error-outdated">{outdated}</p>}
      {wayOut && handler && (
        <Button type="button" variant="outline" size="sm" disabled={tutor.isLoading} onClick={handler} data-testid="tutor-error-action">
          {WAY_OUT_LABELS[wayOut]}
        </Button>
      )}
    </div>
  );
}

export function TutorPending({ tutor, label }: { readonly tutor: TutorPanelState; readonly label: string }) {
  return (
    <output className="flex items-center gap-2 text-ui-sm text-muted-foreground" aria-live="polite" data-testid="tutor-pending">
      {tutor.isLoading && (
        <>
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {label}
        </>
      )}
    </output>
  );
}

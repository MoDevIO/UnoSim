export type TutorQuestionVisualState =
  | "idle"
  | "generating"
  | "waiting"
  | "evaluating"
  | "error";

export type TutorQuestionVisualAnimation = Exclude<TutorQuestionVisualState, "idle">;

export interface TutorQuestionVisualInput {
  readonly tutorReady: boolean;
  readonly question: unknown;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export interface TutorQuestionVisualTreatment {
  readonly state: TutorQuestionVisualState;
  readonly label: string;
  readonly status: "bright" | "error";
  readonly animation?: TutorQuestionVisualAnimation;
}

/** Derives the Tutor header treatment from existing state without changing Tutor behavior. */
export function getTutorQuestionVisualState({
  tutorReady,
  question,
  isLoading,
  error,
}: TutorQuestionVisualInput): TutorQuestionVisualTreatment {
  let state: TutorQuestionVisualState;
  if (error) {
    state = "error";
  } else if (isLoading && question === null) {
    state = "generating";
  } else if (isLoading) {
    state = "evaluating";
  } else if (question === null) {
    state = "idle";
  } else {
    state = "waiting";
  }

  switch (state) {
    case "generating":
      return {
        state,
        label: "Tutor erstellt eine Frage",
        status: "bright",
        animation: state,
      };
    case "waiting":
      return {
        state,
        label: "Tutor wartet auf deine Antwort",
        status: "bright",
        animation: state,
      };
    case "evaluating":
      return {
        state,
        label: "Tutor bearbeitet deine Anfrage",
        status: "bright",
        animation: state,
      };
    case "error":
      return {
        state,
        label: "Tutor-Fehler",
        status: "error",
        animation: state,
      };
    case "idle":
      return {
        state,
        label: tutorReady ? "Tutor bereit" : "Tutor nicht eingerichtet",
        status: "bright",
      };
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type TutorDialogTurn,
  calculateNextTutorDifficulty,
  clampTutorDifficulty,
  TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY,
  TUTOR_DEFAULT_DIFFICULTY,
  tutorDifficultySchema,
  tutorModelsResponseSchema,
  tutorResponseSchema,
  type TutorAnswerRating,
  type TutorDifficulty,
  type TutorFocusProgress,
  type TutorResponse,
  type TutorCourseContentContext,
  type TutorSupportAction,
  type TutorSupportState,
} from "@shared/tutor";
import type { BoardId } from "@shared/boards";
import type { TutorReferenceView } from "@shared/tutor-support";
import { INPUT_LIMITS } from "@shared/input-limits";
import { getServerCapabilities, type ServerCapabilities } from "@/lib/server-capabilities";
import { refreshExternalExamplesCatalog, resolveTutorCourseContent, useExternalExamples } from "@/lib/external-examples";

interface TutorConfig {
  readonly provider: string;
}

export interface TutorPanelState {
  readonly capabilities: ServerCapabilities;
  readonly config: TutorConfig;
  readonly credential: string;
  readonly setCredential: (value: string) => void;
  readonly clearCredential: () => void;
  readonly selectedModel: string;
  readonly setSelectedModel: (value: string) => void;
  readonly lastUsedModel: string | null;
  readonly configuredDifficulty: TutorDifficulty;
  readonly effectiveDifficulty: TutorDifficulty;
  readonly setConfiguredDifficulty: (value: number) => void;
  readonly sessionRating: number | null;
  readonly ratedAnswerCount: number;
  readonly availableModels: readonly string[];
  readonly modelsLoading: boolean;
  readonly loadModels: () => Promise<void>;
  readonly question: TutorResponse | null;
  /** Where the learner stands in the teacher's focus; null without a focus. */
  readonly focusProgress: TutorFocusProgress | null;
  readonly history: readonly TutorDialogTurn[];
  /** Everything the learner sees in order: answers, clarifications, hints, the reference answer and skips. */
  readonly transcript: readonly TutorTranscriptEntry[];
  /** Server-owned learning-support state of the asked question (LearningQuestions 3.10). */
  readonly support: TutorSupportState | null;
  /** Set when skipping ended the dialog because no further question was left. */
  readonly completed: boolean;
  readonly requestSupport: (action: TutorSupportAction, sketch: string | TutorSketch) => Promise<void>;
  readonly answer: string;
  readonly setAnswer: (value: string) => void;
  readonly submitAnswer: (sketch: string | TutorSketch) => Promise<void>;
  /**
   * Set while an answer closed its question and the next step waits behind `Weiter zur nächsten Frage`
   * (LearningQuestions 10.7): the answered question stays shown, and no answer or help can be sent.
   */
  readonly awaitingNext: boolean;
  /** Shows the next step that was already received; no request, nothing is counted again. */
  readonly continueToNextQuestion: () => void;
  readonly resetDialog: () => void;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** The server's code of the failure, or the code a local check stands in for; the panel picks its way out by it. */
  readonly errorCode: string | null;
  /** What the failed request was, while its failure is shown; null when nothing failed or a check failed. */
  readonly failedRequest: TutorFailedRequestKind | null;
  /**
   * Repeats exactly the request that failed, with its content and action id (R-SUP-1), the model list included.
   * Null when nothing failed, or when the code or the draft changed since: sending again is then a new action
   * with the current inputs, and a repeat must never mix the old content with the new (review of 08f71c96b).
   */
  readonly retryFor: (current: string | TutorSketch) => (() => void) | null;
  /** What the running request does, for the waiting message. */
  readonly pendingRequest: TutorRequestKind;
  readonly generateQuestion: (sketch: string | TutorSketch) => Promise<void>;
}

/**
 * What a Tutor request is about (LearningQuestions SSOT): the entry file `code`, the other files of the
 * project as `POST /api/compile` receives them, and the selected board. A string is a lone sketch.
 */
export interface TutorSketch {
  readonly code: string;
  readonly headers?: readonly { readonly name: string; readonly content: string }[];
  readonly entryFile?: string;
  readonly board?: BoardId;
}

/** The learner's requests that the panel waits for. */
export type TutorRequestKind = "question" | "answer" | "support";

/** A failed request with all it sent, so that a repeat sends the same content with the same action id. */
type TutorFailedRequest =
  | { readonly kind: "models" }
  | { readonly kind: "question"; readonly sketch: TutorSketch; readonly difficulty: TutorDifficulty }
  | { readonly kind: "answer"; readonly sketch: TutorSketch; readonly answer: string; readonly actionId?: string }
  | { readonly kind: "support"; readonly action: TutorSupportAction; readonly sketch: TutorSketch; readonly actionId: string };

export type TutorFailedRequestKind = TutorFailedRequest["kind"];

/** One entry of what the learner sees, in the order it happened. */
export type TutorTranscriptContent =
  | { readonly kind: "turn"; readonly turn: TutorDialogTurn; readonly assisted?: true }
  | { readonly kind: "clarification"; readonly question: string; readonly text: string; readonly learnerText?: string }
  | { readonly kind: "hint"; readonly question: string; readonly text: string; readonly learnerText?: string }
  | { readonly kind: "reference"; readonly question: string; readonly reference: TutorReferenceView }
  | { readonly kind: "skip"; readonly question: string };

/** A transcript entry with the id the view uses as its key. */
export type TutorTranscriptEntry = TutorTranscriptContent & { readonly id: string };

const withEntryId = (entry: TutorTranscriptContent): TutorTranscriptEntry => ({ ...entry, id: globalThis.crypto.randomUUID() });

/** A typed question about the question or a request for help: shown with its explanation, not rated (R-SUP-1). */
function typedHelpEntry(response: TutorResponse, question: string, learnerText: string): TutorTranscriptContent | null {
  const input = response.learnerInput ?? "answer";
  if (input === "answer") return null;
  return { kind: input === "clarification" ? "clarification" : "hint", question, text: response.feedback ?? "", learnerText };
}

const asTutorSketch = (sketch: string | TutorSketch): TutorSketch => (typeof sketch === "string" ? { code: sketch } : sketch);

function sketchRequestFields({ code, headers, entryFile, board }: TutorSketch) {
  return { code, ...(headers?.length ? { headers } : {}), ...(entryFile ? { entryFile } : {}), ...(board ? { board } : {}) };
}

/** The sketch as a request sends it; equal keys mean the same project, files and board. */
const sketchKey = (sketch: TutorSketch): string => JSON.stringify(sketchRequestFields(sketch));

const DEFAULT_CONFIG: TutorConfig = {
  provider: "kiconnect",
};

const ERROR_MESSAGES = new Map<string, string>([
  ["CREDENTIAL_REQUIRED", "Trage zuerst deinen persönlichen Tutor-API-Key ein."],
  ["CREDENTIAL_INVALID", "Der Tutor-Zugang wurde abgelehnt."],
  ["PROVIDER_UNAVAILABLE", "Der Tutor-Dienst ist gerade nicht erreichbar."],
  ["PROVIDER_TIMEOUT", "Der Tutor-Dienst hat zu lange nicht geantwortet."],
  ["RATE_LIMITED", "Das Anfragelimit des Tutors ist erreicht. Bitte versuche es später erneut."],
  ["MODEL_UNAVAILABLE", "Das gewählte Tutor-Modell ist nicht verfügbar."],
  ["AUTO_MODEL_UNAVAILABLE", "Für „Automatisch“ ist kein freigegebenes Modell verfügbar. Wähle in den Einstellungen unter „Modell“ ein Modell."],
  ["INVALID_PROVIDER_RESPONSE", "Der Tutor-Dienst hat eine ungültige Antwort geliefert."],
  ["INVALID_REQUEST", "Die Tutor-Anfrage ist ungültig."],
  ["COURSE_CONTENT_STALE", "Die Kursinhalte wurden aktualisiert. Lade das Beispiel über das Menü „Examples“ neu, um weiterzumachen."],
  ["SUPPORT_LOCKED", "Diese Hilfe ist für die Frage noch nicht freigeschaltet."],
  ["SUPPORT_CONFLICT", "Die Frage hat sich inzwischen geändert. Mach mit der aktuellen Frage weiter."],
  ["SUPPORT_SESSION_INVALID", "Die Lernsitzung ist abgelaufen oder die Kursinhalte sind wieder verfügbar. Starte eine neue Lernrunde."],
  ["NO_CODE", "Öffne zuerst einen Sketch mit Quellcode."],
  ["NO_QUESTION", "Starte zuerst eine Lernfrage."],
  ["NO_ANSWER", "Schreibe zuerst eine Antwort."],
]);

const GENERIC_FAILURE = "Die Tutor-Anfrage ist fehlgeschlagen.";
const INVALID_RESPONSE = "Der Tutor-Dienst hat eine ungültige Antwort geliefert.";

/** A failed Tutor request with the code the panel uses to offer the matching way out (LearningQuestions 10.7). */
class TutorRequestError extends Error {
  constructor(readonly code: string | null, message: string) {
    super(message);
    this.name = "TutorRequestError";
  }
}

function getErrorMessage(body: unknown): string {
  return ERROR_MESSAGES.get(getErrorCode(body) ?? "") ?? GENERIC_FAILURE;
}

function getErrorCode(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "code" in body.error &&
    typeof body.error.code === "string"
  ) {
    return body.error.code;
  }
  return undefined;
}

function getTutorFailure(body: unknown): Error {
  if (getErrorCode(body) === "COURSE_CONTENT_STALE") {
    // The server moved on to a newer Course revision; refresh the catalog so the Examples menu offers it.
    refreshExternalExamplesCatalog().catch(() => undefined);
  }
  return new TutorRequestError(getErrorCode(body) ?? null, getErrorMessage(body));
}

/** The code of the first missing precondition of an answer, if any. */
function getSubmitAnswerValidationError({
  question,
  code,
  answer,
  credential,
}: {
  question: TutorResponse | null;
  code: string;
  answer: string;
  credential: string;
}): string | undefined {
  if (!question) return "NO_QUESTION";
  if (!code.trim()) return "NO_CODE";
  if (!answer.trim()) return "NO_ANSWER";
  if (!credential.trim()) return "CREDENTIAL_REQUIRED";
  return undefined;
}

function getRequestedModel(selectedModel: string, availableModels: readonly string[]): string | undefined {
  if (selectedModel === "auto") return undefined;
  return availableModels.includes(selectedModel) ? selectedModel : undefined;
}

function getCourseContentRequest(
  courseContentSession: string | undefined,
  courseContent: TutorCourseContentContext | undefined,
): { courseContentSession?: string; courseContent?: TutorCourseContentContext } {
  if (courseContentSession) return { courseContentSession };
  if (courseContent) return { courseContent };
  return {};
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * One answered question of the history: identity and learning metadata belong to the question that was
 * asked, feedback and rating to the response. The response's other metadata describe the next question.
 */
function buildDialogTurn(
  question: TutorResponse,
  answer: string,
  response: TutorResponse,
): TutorDialogTurn {
  const baseTurn = {
    question: question.question,
    answer,
    ...(response.feedback ? { feedback: response.feedback } : {}),
    ...buildDialogTurnMetadata(question),
  };
  if (response.responseStyle === "philosophical") {
    return { ...baseTurn, responseStyle: "philosophical" };
  }
  return {
    ...baseTurn,
    responseStyle: "normal",
    ...(response.answerRating === undefined ? {} : { answerRating: response.answerRating }),
  };
}

const DIALOG_TURN_METADATA = [
  "topicId", "conceptId", "questionId", "indicatorId", "questionKind", "strategyId", "strategySource",
  "contentRevision", "learningPhase", "activeTopicId", "masteredTopicIds", "progressionBlockedReason", "extensionTargetTopicId",
] as const;

function buildDialogTurnMetadata(response: TutorResponse): Partial<Pick<TutorDialogTurn, (typeof DIALOG_TURN_METADATA)[number]>> {
  return Object.fromEntries(DIALOG_TURN_METADATA.flatMap((field) => (response[field] ? [[field, response[field]]] : [])));
}

function collectAnswerRatings(history: readonly TutorDialogTurn[]): readonly TutorAnswerRating[] {
  return history.flatMap((turn) => turn.answerRating === undefined ? [] : [turn.answerRating]);
}

function buildDialogResponseUpdate(
  currentHistory: readonly TutorDialogTurn[],
  currentQuestion: TutorResponse,
  submittedAnswer: string,
  response: TutorResponse,
  currentSession: string | undefined,
): {
  readonly nextHistory: readonly TutorDialogTurn[];
  readonly answerRatings?: readonly TutorAnswerRating[];
  readonly nextSession?: string;
  readonly lastUsedModel?: string;
} {
  const nextHistory = [
    ...currentHistory,
    buildDialogTurn(currentQuestion, submittedAnswer, response),
  ].slice(-INPUT_LIMITS.tutor.maxHistoryEntries);
  const answerRatings = response.responseStyle === "normal" && response.answerRating !== undefined
    ? collectAnswerRatings(nextHistory)
    : undefined;
  return {
    nextHistory,
    ...(answerRatings === undefined ? {} : { answerRatings }),
    nextSession: response.courseContentSession ?? currentSession,
    ...(response.responseStyle === "normal" ? { lastUsedModel: response.model } : {}),
  };
}

/** The id of a learner action; the same action (same question, kind and input) keeps its id until it succeeded. */
function actionIdFor(pending: { current: { readonly key: string; readonly actionId: string } | null }, key: string): string {
  if (pending.current?.key !== key) pending.current = { key, actionId: globalThis.crypto.randomUUID() };
  return pending.current.actionId;
}

function supportBinding(support: TutorSupportState, actionId: string) {
  return { supportSession: support.session, questionHandle: support.questionHandle, actionId };
}

/**
 * The action id of an answer. The same answer to the same code keeps its id; another answer or other code is
 * another action, because the server keeps a result per id.
 */
function answerActionId(
  support: TutorSupportState,
  answer: string,
  sketch: TutorSketch,
  pending: { current: { readonly key: string; readonly actionId: string } | null },
): string {
  return actionIdFor(pending, `${support.questionHandle}|answer|${answer}|${sketchKey(sketch)}`);
}

/** Whether an answer moved on to another question; a weak answer keeps the question and its handle. */
function answerAdvanced(asked: TutorResponse, askedSupport: TutorSupportState | null, response: TutorResponse): boolean {
  if (askedSupport && response.support) return response.support.questionHandle !== askedSupport.questionHandle;
  return response.question !== asked.question;
}

/** An answered turn; after the reference answer it is marked as not rated (R-SUP-5). */
function answerEntry(turn: TutorDialogTurn, support: TutorSupportState | null): TutorTranscriptContent {
  return support?.referenceShown ? { kind: "turn", turn, assisted: true } : { kind: "turn", turn };
}

/** Sends an answer; null when the request was aborted. */
async function postDialogAnswer(body: Record<string, unknown>, signal: AbortSignal): Promise<{ readonly data: TutorResponse } | null> {
  const response = await fetch("/api/tutor/dialog", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (signal.aborted) return null;
  if (!response.ok) throw getTutorFailure(payload);
  const parsed = tutorResponseSchema.safeParse(payload);
  if (!parsed.success) throw new TutorRequestError("INVALID_PROVIDER_RESPONSE", INVALID_RESPONSE);
  return { data: parsed.data };
}

function readConfiguredDifficulty(): TutorDifficulty {
  try {
    const stored = globalThis.localStorage?.getItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY);
    if (stored === null || stored === undefined) return TUTOR_DEFAULT_DIFFICULTY;
    const parsed = tutorDifficultySchema.safeParse(Number(stored));
    return parsed.success ? parsed.data : TUTOR_DEFAULT_DIFFICULTY;
  } catch {
    return TUTOR_DEFAULT_DIFFICULTY;
  }
}

function persistConfiguredDifficulty(value: TutorDifficulty): void {
  try {
    globalThis.localStorage?.setItem(TUTOR_CONFIGURED_DIFFICULTY_STORAGE_KEY, String(value));
  } catch {
    // Browser storage can be unavailable in private/restricted contexts.
  }
}

export function useTutor(
  capabilities: ServerCapabilities = getServerCapabilities(true),
): TutorPanelState {
  const { learningSituation } = useExternalExamples();
  // Set when a dialog starts: the dialog stays with its context until the next learning situation.
  const dialogCourseContent = useRef<TutorCourseContentContext | undefined>(undefined);
  const [courseContentSession, setCourseContentSession] = useState<string | undefined>();
  const [config, setConfig] = useState<TutorConfig>(DEFAULT_CONFIG);
  const [credential, setCredential] = useState("");
  const [selectedModel, setSelectedModel] = useState("auto");
  const [lastUsedModel, setLastUsedModel] = useState<string | null>(null);
  const [configuredDifficulty, setConfiguredDifficulty] = useState<TutorDifficulty>(readConfiguredDifficulty);
  const [effectiveDifficulty, setEffectiveDifficulty] = useState<TutorDifficulty>(() => configuredDifficulty);
  const [availableModels, setAvailableModels] = useState<readonly string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [question, setQuestion] = useState<TutorResponse | null>(null);
  const [focusProgress, setFocusProgress] = useState<TutorFocusProgress | null>(null);
  const [history, setHistory] = useState<readonly TutorDialogTurn[]>([]);
  const [transcript, setTranscript] = useState<readonly TutorTranscriptEntry[]>([]);
  const [support, setSupport] = useState<TutorSupportState | null>(null);
  const [completed, setCompleted] = useState(false);
  // The next step an answer already received, held back until the learner reads the feedback and goes on.
  const [heldNext, setHeldNext] = useState<{ readonly question: TutorResponse; readonly support: TutorSupportState | null } | null>(null);
  // A retry of the same action keeps its id, so the server counts it once (LearningQuestions R-SUP-1).
  const pendingAction = useRef<{ readonly key: string; readonly actionId: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<TutorRequestKind>("question");
  // The failure keeps the request it belongs to, so a repeat can never send another one (review R1).
  const [failure, setFailure] = useState<{ readonly message: string; readonly code: string | null; readonly request?: TutorFailedRequest } | null>(null);
  const error = failure?.message ?? null;
  const errorCode = failure?.code ?? null;
  const clearError = useCallback(() => setFailure(null), []);
  const fail = useCallback((code: string) => setFailure({ message: ERROR_MESSAGES.get(code) ?? GENERIC_FAILURE, code }), []);
  const failWith = useCallback((requestError: unknown, request: TutorFailedRequest) => {
    if (requestError instanceof TutorRequestError) setFailure({ message: requestError.message, code: requestError.code, request });
    else setFailure({ message: requestError instanceof Error ? requestError.message : GENERIC_FAILURE, code: null, request });
  }, []);
  const canLoadConfigOnMount = useRef(capabilities.canUseTutor);
  const activeTutorRequests = useRef(new Set<AbortController>());
  const loadingRequest = useRef<AbortController | null>(null);
  const abortPendingTutorRequests = useCallback(() => {
    for (const controller of activeTutorRequests.current) controller.abort();
    activeTutorRequests.current.clear();
  }, []);

  // Credential, model and start difficulty stay; a new project or course is a new learning situation.
  const clearDialog = useCallback((startDifficulty: TutorDifficulty) => {
    abortPendingTutorRequests();
    // The aborted request may still wait for the shared catalog; the new situation must not wait with it.
    loadingRequest.current = null;
    setIsLoading(false);
    dialogCourseContent.current = undefined;
    setCourseContentSession(undefined);
    setHistory([]);
    setTranscript([]);
    setSupport(null);
    setCompleted(false);
    setHeldNext(null);
    pendingAction.current = null;
    setQuestion(null);
    setFocusProgress(null);
    setAnswer("");
    clearError();
    setEffectiveDifficulty(startDifficulty);
  }, [abortPendingTutorRequests, clearError]);

  useEffect(() => {
    clearDialog(configuredDifficulty);
  }, [clearDialog, learningSituation]);

  useEffect(() => () => abortPendingTutorRequests(), [abortPendingTutorRequests]);

  useEffect(() => {
    if (!canLoadConfigOnMount.current) return;
    let cancelled = false;
    fetch("/api/config", { cache: "no-store", credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Tutor configuration is unavailable.");
        return response.json() as Promise<{ tutor?: Partial<TutorConfig> }>;
      })
      .then((data) => {
        if (cancelled || !data.tutor) return;
        setConfig({
          provider: data.tutor.provider ?? DEFAULT_CONFIG.provider,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setTutorCredential = useCallback((value: string) => {
    setCredential(value);
    setAvailableModels([]);
    setSelectedModel("auto");
  }, []);

  const clearCredential = useCallback(() => setTutorCredential(""), [setTutorCredential]);

  const loadModels = useCallback(async () => {
    if (!capabilities.canUseTutor) return;
    clearError();
    if (!credential.trim()) {
      fail("CREDENTIAL_REQUIRED");
      return;
    }

    setModelsLoading(true);
    const controller = new AbortController();
    activeTutorRequests.current.add(controller);
    try {
      const response = await fetch("/api/tutor/models", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new TutorRequestError(getErrorCode(body) ?? null, getErrorMessage(body));
      const parsed = tutorModelsResponseSchema.safeParse(body);
      if (!parsed.success) throw new TutorRequestError("INVALID_PROVIDER_RESPONSE", "Der Tutor-Dienst hat eine ungültige Modellliste geliefert.");
      setAvailableModels(parsed.data.models);
      setSelectedModel((current) => current === "auto" || parsed.data.models.includes(current) ? current : "auto");
    } catch (requestError) {
      if (controller.signal.aborted || isAbortError(requestError)) return;
      setAvailableModels([]);
      setSelectedModel("auto");
      failWith(requestError, { kind: "models" });
    } finally {
      activeTutorRequests.current.delete(controller);
      setModelsLoading(false);
    }
  }, [capabilities, credential, fail, failWith, clearError]);

  // An aborted request ends after its successor started; only the newest one ends the loading state.
  const finishLoading = useCallback((controller: AbortController) => {
    if (loadingRequest.current !== controller) return;
    loadingRequest.current = null;
    setIsLoading(false);
  }, []);

  const requestQuestion = useCallback(async (sketch: TutorSketch, requestDifficulty: TutorDifficulty) => {
    if (!capabilities.canUseTutor) return;
    clearError();
    if (!sketch.code.trim()) {
      fail("NO_CODE");
      return;
    }
    if (!credential.trim()) {
      fail("CREDENTIAL_REQUIRED");
      return;
    }
    const requestedModel = getRequestedModel(selectedModel, availableModels);
    if (selectedModel !== "auto" && !requestedModel) setSelectedModel("auto");

    setIsLoading(true);
    setPendingRequest("question");
    const controller = new AbortController();
    activeTutorRequests.current.add(controller);
    loadingRequest.current = controller;
    try {
      const courseContent = await resolveTutorCourseContent(controller.signal);
      if (controller.signal.aborted) return;
      dialogCourseContent.current = courseContent;
      const response = await fetch("/api/tutor/question", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...sketchRequestFields(sketch),
          credential,
          ...(requestedModel ? { model: requestedModel } : {}),
          difficulty: requestDifficulty,
          // A new learning question starts a fresh didactic session (LearningQuestions SSOT 2.3).
          ...getCourseContentRequest(undefined, courseContent),
          learningSupport: true,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) throw getTutorFailure(body);
      const parsed = tutorResponseSchema.safeParse(body);
      if (!parsed.success) throw new TutorRequestError("INVALID_PROVIDER_RESPONSE", INVALID_RESPONSE);
      setQuestion(parsed.data);
      setSupport(parsed.data.support ?? null);
      setCompleted(false);
      setFocusProgress(parsed.data.focusProgress ?? null);
      setCourseContentSession(parsed.data.courseContentSession);
      setLastUsedModel(parsed.data.model);
      setAnswer("");
    } catch (requestError) {
      if (controller.signal.aborted || isAbortError(requestError)) return;
      failWith(requestError, { kind: "question", sketch, difficulty: requestDifficulty });
    } finally {
      activeTutorRequests.current.delete(controller);
      finishLoading(controller);
    }
  }, [availableModels, capabilities, credential, fail, failWith, finishLoading, selectedModel, clearError]);

  const resetDialog = useCallback(() => clearDialog(configuredDifficulty), [clearDialog, configuredDifficulty]);

  const generateQuestion = useCallback(async (input: string | TutorSketch) => {
    if (!capabilities.canUseTutor) return;
    const sketch = asTutorSketch(input);
    // Any dialog state ends here, also a dialog completed by skipping without an answer (review R8).
    if (question !== null || history.length > 0 || transcript.length > 0 || completed) {
      resetDialog();
      await requestQuestion(sketch, configuredDifficulty);
      return;
    }
    await requestQuestion(sketch, effectiveDifficulty);
  }, [capabilities, completed, configuredDifficulty, effectiveDifficulty, history.length, question, requestQuestion, resetDialog, transcript.length]);

  // Everything an answer books is applied at once; only showing the next question waits for the learner.
  const applyDialogResponse = useCallback((response: TutorResponse, update: ReturnType<typeof buildDialogResponseUpdate>) => {
    setHistory(update.nextHistory);
    if (update.answerRatings !== undefined) {
      setEffectiveDifficulty((current) => calculateNextTutorDifficulty(current, update.answerRatings!));
    }
    setFocusProgress((current) => response.focusProgress ?? current);
    setCourseContentSession(update.nextSession);
    if (update.lastUsedModel !== undefined) setLastUsedModel(update.lastUsedModel);
    setAnswer("");
  }, []);

  /** Sends one answer as it is given; a repeat passes the action id of the failed attempt (R-SUP-1). */
  const sendAnswer = useCallback(async (sketch: TutorSketch, submittedAnswer: string, repeatedActionId?: string) => {
    if (!question || heldNext) return;
    const requestedModel = getRequestedModel(selectedModel, availableModels);
    if (selectedModel !== "auto" && !requestedModel) setSelectedModel("auto");
    const currentQuestion = question;
    const currentHistory = history;
    const currentSupport = support;
    // Outside the support cycle an answer has no binding.
    const actionId = currentSupport ? repeatedActionId ?? answerActionId(currentSupport, submittedAnswer, sketch, pendingAction) : undefined;
    const binding = currentSupport && actionId ? supportBinding(currentSupport, actionId) : {};

    clearError();
    setIsLoading(true);
    setPendingRequest("answer");
    const controller = new AbortController();
    activeTutorRequests.current.add(controller);
    loadingRequest.current = controller;
    try {
      const parsed = await postDialogAnswer({
        ...sketchRequestFields(sketch),
        history: currentHistory,
        question: currentQuestion.question,
        answer: submittedAnswer,
        credential,
        ...(requestedModel ? { model: requestedModel } : {}),
        difficulty: effectiveDifficulty,
        ...getCourseContentRequest(courseContentSession, dialogCourseContent.current),
        ...binding,
      }, controller.signal);
      if (!parsed) return;
      pendingAction.current = null;
      const helpEntry = typedHelpEntry(parsed.data, currentQuestion.question, submittedAnswer);
      if (helpEntry) {
        if (parsed.data.support) setSupport(parsed.data.support);
        setTranscript((current) => [...current, withEntryId(helpEntry)]);
        setCourseContentSession(parsed.data.courseContentSession ?? courseContentSession);
        setAnswer("");
        return;
      }
      const update = buildDialogResponseUpdate(currentHistory, currentQuestion, submittedAnswer, parsed.data, courseContentSession);
      setTranscript((current) => [...current, withEntryId(answerEntry(update.nextHistory.at(-1)!, currentSupport))]);
      applyDialogResponse(parsed.data, update);
      if (answerAdvanced(currentQuestion, currentSupport, parsed.data)) {
        setHeldNext({ question: parsed.data, support: parsed.data.support ?? null });
      } else {
        // A weak answer: the same question stays open and editable, with the server's new counts.
        setQuestion(parsed.data);
        if (parsed.data.support) setSupport(parsed.data.support);
      }
    } catch (requestError) {
      // Keep the current question, answer, and history intact so a failed
      // request can be retried deliberately by the learner.
      if (controller.signal.aborted || isAbortError(requestError)) return;
      failWith(requestError, { kind: "answer", sketch, answer: submittedAnswer, ...(actionId ? { actionId } : {}) });
    } finally {
      activeTutorRequests.current.delete(controller);
      finishLoading(controller);
    }
  }, [applyDialogResponse, availableModels, courseContentSession, credential, effectiveDifficulty, failWith, finishLoading, heldNext, history, question, selectedModel, clearError, support]);

  const submitAnswer = useCallback(async (input: string | TutorSketch) => {
    if (!capabilities.canUseTutor || heldNext) return;
    clearError();
    const sketch = asTutorSketch(input);
    const validationError = getSubmitAnswerValidationError({
      question,
      code: sketch.code,
      answer,
      credential,
    });
    if (validationError) {
      fail(validationError);
      return;
    }
    await sendAnswer(sketch, answer.trim());
  }, [answer, capabilities, clearError, credential, fail, heldNext, question, sendAnswer]);

  const continueToNextQuestion = useCallback(() => {
    if (!heldNext) return;
    setQuestion(heldNext.question);
    setSupport(heldNext.support);
    setHeldNext(null);
  }, [heldNext]);

  const requestSupport = useCallback(async (action: TutorSupportAction, input: string | TutorSketch, repeatedActionId?: string) => {
    if (!capabilities.canUseTutor || !question || !support || heldNext) return;
    clearError();
    const sketch = asTutorSketch(input);
    if (!credential.trim()) {
      fail("CREDENTIAL_REQUIRED");
      return;
    }
    const requestedModel = getRequestedModel(selectedModel, availableModels);
    const currentQuestion = question;
    const actionId = repeatedActionId
      ?? actionIdFor(pendingAction, `${support.questionHandle}|${action}|${support.clarifications}|${support.answerAttempts}|${sketchKey(sketch)}`);
    setIsLoading(true);
    setPendingRequest("support");
    const controller = new AbortController();
    activeTutorRequests.current.add(controller);
    loadingRequest.current = controller;
    try {
      // Loaded on the first support action only; it is not part of the page's start.
      const { sendTutorSupportAction, supportOutcome } = await import("@/lib/tutor-support-request");
      const result = await sendTutorSupportAction({
        ...sketchRequestFields(sketch),
        history,
        action,
        credential,
        ...(requestedModel ? { model: requestedModel } : {}),
        difficulty: effectiveDifficulty,
        ...getCourseContentRequest(courseContentSession, dialogCourseContent.current),
        ...supportBinding(support, actionId),
      }, controller.signal, getTutorFailure);
      if (!result || controller.signal.aborted) return;
      pendingAction.current = null;
      setCourseContentSession(result.courseContentSession ?? courseContentSession);
      if (result.focusProgress) setFocusProgress(result.focusProgress);
      const outcome = supportOutcome(result, currentQuestion.question);
      setTranscript((current) => [...current, withEntryId(outcome.entry)]);
      if (outcome.next !== undefined) {
        setAnswer("");
        setQuestion(outcome.next);
        setCompleted(outcome.next === null);
      }
      setSupport(result.support ?? null);
    } catch (requestError) {
      if (controller.signal.aborted || isAbortError(requestError)) return;
      failWith(requestError, { kind: "support", action, sketch, actionId });
    } finally {
      activeTutorRequests.current.delete(controller);
      finishLoading(controller);
    }
  }, [availableModels, capabilities, courseContentSession, credential, effectiveDifficulty, fail, failWith, finishLoading, heldNext, history, question, selectedModel, clearError, support]);

  const failedRequest = failure?.request;
  const retryFor = useCallback((current: string | TutorSketch): (() => void) | null => {
    if (!failedRequest) return null;
    if (failedRequest.kind === "models") return () => void loadModels();
    // A repeat sends what failed; after an edit that would be old code with a new draft, or the reverse.
    if (sketchKey(failedRequest.sketch) !== sketchKey(asTutorSketch(current))) return null;
    switch (failedRequest.kind) {
      case "question":
        return () => void requestQuestion(failedRequest.sketch, failedRequest.difficulty);
      case "answer":
        if (answer.trim() !== failedRequest.answer) return null;
        return () => void sendAnswer(failedRequest.sketch, failedRequest.answer, failedRequest.actionId);
      case "support":
        return () => void requestSupport(failedRequest.action, failedRequest.sketch, failedRequest.actionId);
    }
  }, [answer, failedRequest, loadModels, requestQuestion, requestSupport, sendAnswer]);

  const updateConfiguredDifficulty = useCallback((value: number) => {
    const nextDifficulty = clampTutorDifficulty(value);
    setConfiguredDifficulty(nextDifficulty);
    persistConfiguredDifficulty(nextDifficulty);
    if (history.length === 0 && question === null) setEffectiveDifficulty(nextDifficulty);
  }, [history.length, question]);

  const { sessionRating, ratedAnswerCount } = useMemo(() => {
    const ratings = history.flatMap((turn) => turn.answerRating === undefined ? [] : [turn.answerRating]);
    if (ratings.length === 0) return { sessionRating: null, ratedAnswerCount: 0 };
    return {
      sessionRating: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
      ratedAnswerCount: ratings.length,
    };
  }, [history]);

  return useMemo(() => ({
    capabilities,
    config,
    credential,
    setCredential: setTutorCredential,
    clearCredential,
    selectedModel,
    setSelectedModel,
    lastUsedModel,
    configuredDifficulty,
    effectiveDifficulty,
    setConfiguredDifficulty: updateConfiguredDifficulty,
    sessionRating,
    ratedAnswerCount,
    availableModels,
    modelsLoading,
    loadModels,
    question,
    focusProgress,
    history,
    transcript,
    support,
    completed,
    requestSupport,
    answer,
    setAnswer,
    submitAnswer,
    awaitingNext: heldNext !== null,
    continueToNextQuestion,
    resetDialog,
    isLoading,
    error,
    errorCode,
    failedRequest: failedRequest?.kind ?? null,
    retryFor,
    pendingRequest,
    generateQuestion,
  }), [
    transcript,
    support,
    completed,
    requestSupport,
    capabilities,
    config,
    credential,
    clearCredential,
    error,
    errorCode,
    failedRequest,
    retryFor,
    heldNext,
    continueToNextQuestion,
    pendingRequest,
    generateQuestion,
    loadModels,
    isLoading,
    modelsLoading,
    question,
    focusProgress,
    history,
    answer,
    submitAnswer,
    resetDialog,
    selectedModel,
    setTutorCredential,
    availableModels,
    lastUsedModel,
    configuredDifficulty,
    effectiveDifficulty,
    updateConfiguredDifficulty,
    sessionRating,
    ratedAnswerCount,
  ]);
}

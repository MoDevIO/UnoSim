import { registerTutorDiagnosticDecoder } from "./tutor-diagnostic-events";
import {
  describeTutorDiagnostic, tutorDiagnosticEnvelopeSchema, tutorDiagnosticOperation, tutorDiagnosticEventSchema,
  type TutorDiagnosticData, type TutorDiagnosticEvent,
} from "@shared/tutor-diagnostics";
import { tutorDiagramType } from "@shared/tutor-mermaid-rules";
import {
  abortTutorReviewStep, addTutorReviewEvent, addTutorReviewLocalStep, beginTutorReviewRequest, clearTutorReviewRuns,
  completeTutorReviewStep, failTutorReviewStep, receiveTutorReviewResponse, setTutorReviewCaptureEnabled,
  setTutorReviewRatingSummary, tutorReviewEpoch, type TutorReviewHandle,
} from "./tutor-review-store";

registerTutorDiagnosticDecoder((value) => {
  const details = tutorDiagnosticEventSchema.safeParse(value).data;
  if (!details) return undefined;
  const sender = details.origin === "provider" || details.origin === "service" ? "server" as const : "frontend" as const;
  return { id: crypto.randomUUID(), timestamp: new Date(details.timestamp), sender, type: `tutor.${details.stage}`, content: describeTutorDiagnostic(details), category: "tutor", details, ...(sender === "server" ? { protocol: "http" as const } : {}) };
});

export const TUTOR_DIAGNOSTIC_EVENT = "tutor-diagnostic";
interface BrowserContext {
  traceId: string;
  requestId: string;
  operation: TutorDiagnosticEvent["operation"];
  sequence: number;
  diagramId?: string;
  aborted: boolean;
  /** The capture epoch at the start; Clear and DEBUG off/on end it for technical events too. */
  readonly epoch: number;
  completed?: boolean;
  graphicReceived?: boolean;
  /** The review capture of this request (LearningQuestions 12.7). */
  review?: TutorReviewHandle;
}
const responses = new WeakMap<object, BrowserContext>();
const requests = new WeakMap<AbortSignal, BrowserContext>();
let serverAvailable: boolean | undefined;
const enabled = () => {
  try { return globalThis.localStorage?.getItem("unoDebugMode") === "1"; } catch { return false; }
};
export function setTutorDiagnosticsAvailable(value: boolean): void { serverAvailable = value; }

function dispatch(event: TutorDiagnosticEvent): void {
  if (!enabled()) return;
  addTutorReviewEvent(event);
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent(TUTOR_DIAGNOSTIC_EVENT, { detail: event }));
}

// DEBUG off ends the review capture, also for requests still running; switching it on begins a new run.
if (typeof document !== "undefined") {
  document.addEventListener("debugModeChange", (event) => {
    setTutorReviewCaptureEnabled(Boolean((event as CustomEvent<{ value?: boolean }>).detail?.value));
  });
}

const REVIEW_ENDPOINT = { question: "question", answer: "dialog", support: "support", models: "models" } as const;
/** A request started before the last Clear or DEBUG off/on must not bring its events back. */
const current = (context: BrowserContext): boolean => context.epoch === tutorReviewEpoch();

function report(context: BrowserContext, data: TutorDiagnosticData): void {
  if (!enabled() || !current(context)) return;
  const parsed = tutorDiagnosticEventSchema.safeParse({
    version: 1, traceId: context.traceId, requestId: context.requestId, operation: context.operation,
    sequence: ++context.sequence, timestamp: new Date().toISOString(),
    ...(context.diagramId ? { diagramId: context.diagramId } : {}), ...data,
  });
  if (parsed.success) dispatch(parsed.data);
}
export function tutorRequestTrace(signal: AbortSignal): string | undefined { return requests.get(signal)?.traceId; }

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function createBrowserContext(input: RequestInfo | URL, traceId: string | undefined): BrowserContext {
  const validTraceId = typeof traceId === "string" && /^[0-9a-f-]{36}$/i.test(traceId);
  return {
    traceId: validTraceId ? traceId : crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    sequence: 0,
    aborted: false,
    epoch: tutorReviewEpoch(),
    operation: tutorDiagnosticOperation(requestPath(input)),
  };
}

/** Announces the request and, when the server may answer with diagnostics, asks for them. */
function startDiagnosticRequest(context: BrowserContext, init: RequestInit | undefined): RequestInit | undefined {
  if (init?.signal) requests.set(init.signal, context);
  context.review = beginTutorReviewRequest({
    traceId: context.traceId, requestId: context.requestId, endpoint: REVIEW_ENDPOINT[context.operation], body: init?.body,
  });
  report(context, { origin: "frontend", stage: "request", outcome: "started" });
  if (serverAvailable === false) {
    report(context, { origin: "frontend", stage: "provider", outcome: "unavailable", reason: "diagnostics-disabled-by-server" });
    return init;
  }
  const headers = new Headers(init?.headers);
  headers.set("X-UnoSim-Tutor-Debug", "1");
  headers.set("X-UnoSim-Tutor-Trace-Id", context.traceId);
  headers.set("X-Request-Id", context.requestId);
  return { ...init, headers };
}

function reportInvalidResponse(context: BrowserContext | undefined): void {
  if (!context || context.aborted) return;
  report(context, { origin: "frontend", stage: "request", outcome: "failed", reason: "invalid-response" });
  failTutorReviewStep(context.review, "invalid-response");
}

/** Forwards the server's events when they belong to this request; otherwise records why they are missing. */
function forwardServerDiagnostics(context: BrowserContext, diagnostics: unknown): void {
  if (!current(context)) return;
  if (diagnostics === undefined) {
    if (serverAvailable !== false) report(context, { origin: "frontend", stage: "provider", outcome: "unavailable" });
    return;
  }
  const parsed = tutorDiagnosticEnvelopeSchema.safeParse(diagnostics);
  const matches = parsed.success && parsed.data.traceId === context.traceId && parsed.data.requestId === context.requestId;
  if (!matches) {
    report(context, { origin: "frontend", stage: "browser", outcome: "rejected", reason: "diagnostics-invalid" });
    return;
  }
  for (const event of parsed.data.events) {
    dispatch(event);
    if (event.diagramId) context.diagramId = event.diagramId;
  }
}

/** Splits the diagnostics block off a parsed payload; the learning content never carries it onwards. */
function receivePayload(payload: unknown, context: BrowserContext | undefined, response: Response): unknown {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    reportInvalidResponse(context);
    return payload;
  }
  const { diagnostics, review, ...body } = payload as Record<string, unknown>;
  if (context && !context.aborted && enabled()) {
    receiveTutorReviewResponse(context.review, { ok: response.ok, httpStatus: response.status, body, review, serverAvailable });
    forwardServerDiagnostics(context, diagnostics);
    responses.set(body, context);
    const status = typeof response.status === "number" ? { statusCode: response.status } : {};
    report(context, { origin: "frontend", stage: "request", outcome: response.ok ? "received" : "failed", ...status });
  }
  return body;
}

/** Intercepts only metadata; never stores or emits the request body or response content. */
export async function tutorDiagnosticFetch(input: RequestInfo | URL, init?: RequestInit, options?: { traceId?: string }): Promise<Response> {
  const context = enabled() ? createBrowserContext(input, options?.traceId) : undefined;
  const requestInit = context ? startDiagnosticRequest(context, init) : init;
  const aborted = () => {
    if (!context || context.aborted) return;
    context.aborted = true;
    report(context, { origin: "frontend", stage: "request", outcome: "aborted", reason: "request-aborted" });
    abortTutorReviewStep(context.review);
  };
  const signal = init?.signal;
  signal?.addEventListener("abort", aborted, { once: true });
  // A signal aborted before this point never fires its event again.
  if (signal?.aborted) aborted();
  try {
    const response = await fetch(input, requestInit);
    const json = response.json.bind(response);
    response.json = async () => {
      try {
        return receivePayload(await json(), context, response);
      } catch (error) {
        reportInvalidResponse(context);
        throw error;
      } finally { signal?.removeEventListener("abort", aborted); }
    };
    return response;
  } catch (error) {
    signal?.removeEventListener("abort", aborted);
    if (signal?.aborted) aborted();
    else if (context) {
      report(context, { origin: "frontend", stage: "request", outcome: "failed", reason: "request-failed" });
      failTutorReviewStep(context.review, "request-failed");
    }
    throw error;
  }
}

/** Keep display correlation outside the learning schemas, history and storage. */
export function bindTutorDiagnosticResponse(source: unknown, target: object): void {
  if (typeof source !== "object" || source === null) return;
  const context = responses.get(source);
  if (!context) return;
  responses.set(target, context);
  if (!context.completed) {
    context.completed = true;
    report(context, { origin: "frontend", stage: "request", outcome: "completed" });
    completeTutorReviewStep(context.review);
  }
  const value = target as Record<string, unknown>;
  if (typeof value.mermaid === "string") {
    context.diagramId ??= crypto.randomUUID();
    if (!context.graphicReceived) {
      context.graphicReceived = true;
      report(context, { origin: "frontend", stage: "browser", outcome: "received", chars: value.mermaid.length, diagramType: tutorDiagramType(value.mermaid) });
    }
  }
  if (typeof value.next === "object" && value.next !== null) bindTutorDiagnosticResponse(target, value.next);
}
export function reportTutorGraphic(subject: object, data: Omit<TutorDiagnosticData, "origin">): void {
  const context = responses.get(subject);
  if (!context || typeof (subject as Record<string, unknown>).mermaid !== "string") return;
  report(context, { ...data, origin: data.stage === "renderer" ? "renderer" : "frontend" });
}

export function rejectTutorDiagnosticResponse(source: unknown): void {
  if (typeof source !== "object" || source === null) return;
  reportInvalidResponse(responses.get(source));
}

/** A local step of the learning flow that relates to a received response: held back, or shown after "Weiter". */
export function reportTutorReviewAction(subject: object, kind: "held" | "displayed"): void {
  const context = responses.get(subject);
  // Only a response captured in the current epoch has a step to relate to; anything else is not recorded.
  if (!enabled() || !context?.review || !current(context)) return;
  addTutorReviewLocalStep(kind, context.review);
}
export function reportTutorReviewReset(): void {
  if (enabled()) addTutorReviewLocalStep("reset");
}
export function reportTutorReviewRatingSummary(summary: Parameters<typeof setTutorReviewRatingSummary>[0]): void {
  if (enabled()) setTutorReviewRatingSummary(summary);
}
export function clearTutorReview(): void { clearTutorReviewRuns(); }

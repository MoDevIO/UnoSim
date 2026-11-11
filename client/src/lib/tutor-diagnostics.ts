import type { TutorDiagnosticData } from "@shared/tutor-diagnostics";

type DiagnosticRuntime = typeof import("./tutor-diagnostic-runtime");
let runtime: DiagnosticRuntime | undefined;
let loading: Promise<DiagnosticRuntime> | undefined;
let serverAvailable: boolean | undefined;
function enabled(): boolean {
  try { return globalThis.localStorage?.getItem("unoDebugMode") === "1"; } catch { return false; }
}
async function load(): Promise<DiagnosticRuntime> {
  loading ??= import("./tutor-diagnostic-runtime").then((module) => {
    runtime = module;
    if (serverAvailable !== undefined) module.setTutorDiagnosticsAvailable(serverAvailable);
    return module;
  });
  return loading;
}
export function setTutorDiagnosticsAvailable(value: boolean): void {
  serverAvailable = value;
  runtime?.setTutorDiagnosticsAvailable(value);
}
export async function tutorDiagnosticFetch(input: RequestInfo | URL, init?: RequestInit, options?: { traceId?: string }): Promise<Response> {
  if (enabled()) {
    const loaded = await load().catch(() => undefined);
    if (loaded) return loaded.tutorDiagnosticFetch(input, init, options);
  }
  const response = await fetch(input, init);
  const json = response.json.bind(response);
  response.json = async () => {
    const payload: unknown = await json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
    // Without the optional runtime, diagnostic and review blocks are dropped before the learning schema.
    const { diagnostics: _diagnostics, review: _review, ...content } = payload as Record<string, unknown>;
    return content;
  };
  return response;
}
export function bindTutorDiagnosticResponse(source: unknown, target: object): void { runtime?.bindTutorDiagnosticResponse(source, target); }
export function reportTutorGraphic(subject: object, data: Omit<TutorDiagnosticData, "origin">): void { runtime?.reportTutorGraphic(subject, data); }
export function tutorRequestTrace(signal: AbortSignal): string | undefined { return runtime?.tutorRequestTrace(signal); }

export function rejectTutorDiagnosticResponse(source: unknown): void { runtime?.rejectTutorDiagnosticResponse(source); }

/** Local review steps (LearningQuestions 12.7); they need the loaded runtime and active DEBUG. */
export function reportTutorReviewAction(subject: object, kind: "held" | "displayed"): void { runtime?.reportTutorReviewAction(subject, kind); }
export function reportTutorReviewReset(): void { runtime?.reportTutorReviewReset(); }
export function reportTutorReviewRatingSummary(summary: { readonly average: number | null; readonly count: number; readonly window: string }): void {
  runtime?.reportTutorReviewRatingSummary(summary);
}
/** Manual Debug clearing also removes every Tutor review run. */
export function clearTutorReview(): void { runtime?.clearTutorReview(); }

import { useCallback, useEffect, useRef, useState } from "react";
import { tutorStartAspectsResponseSchema, type TutorStartAspects } from "@shared/tutor";
import { ensureExternalExamplesCatalog, resolveTutorCourseContent } from "@/lib/external-examples";
import { aspectPlanningRequestField } from "@/lib/tutor-aspect-preference";

/** What the start screen knows about the aspects a new learning round can start with. */
export type TutorStartAspectsState =
  | { readonly status: "idle" | "loading" | "failed" }
  | { readonly status: "ready"; readonly aspects: TutorStartAspects };

/** The sketch as the request sends it. */
export type TutorStartAspectsSketch = {
  readonly code: string;
  readonly headers?: readonly { readonly name: string; readonly content: string }[];
  readonly entryFile?: string;
  readonly board?: string;
};

/** The aspect chosen on the start screen, if the sketch still offers it; the first question is planned for it. */
export function startAspectFocus(state: TutorStartAspectsState, aspectFocus: string | null): string | undefined {
  if (state.status !== "ready" || aspectFocus === null) return undefined;
  return state.aspects.aspectChoices?.some(({ id }) => id === aspectFocus) ? aspectFocus : undefined;
}

/** Edits come in bursts; the lookup waits until the learner pauses. */
const LOOKUP_DELAY_MS = 600;

/**
 * Looks up the aspects of the sketch for the start screen, so the learner can choose one before the first
 * question. It asks no provider. The choices of the last lookup stay while the next one runs.
 */
export function useTutorStartAspects(graphicsProfile: () => string | undefined, learningSituation: number): {
  readonly startAspects: TutorStartAspectsState;
  readonly refreshStartAspects: (sketch: TutorStartAspectsSketch) => void;
} {
  const [startAspects, setStartAspects] = useState<TutorStartAspectsState>({ status: "idle" });
  const pending = useRef<{ readonly controller: AbortController; readonly timer: ReturnType<typeof setTimeout> } | null>(null);
  const lastKey = useRef<string | null>(null);
  const lastSketch = useRef<TutorStartAspectsSketch | null>(null);

  const cancel = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.controller.abort();
    pending.current = null;
  }, []);

  const load = useCallback(async (sketch: TutorStartAspectsSketch, controller: AbortController) => {
    const { signal } = controller;
    try {
      ensureExternalExamplesCatalog();
      const courseContent = await resolveTutorCourseContent(signal);
      if (signal.aborted) return;
      const profile = graphicsProfile();
      const response = await fetch("/api/tutor/aspects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          ...sketch,
          ...(profile ? { graphicsProfile: profile } : {}),
          ...aspectPlanningRequestField(),
          ...(courseContent ? { courseContent } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (signal.aborted) return;
      const parsed = response.ok ? tutorStartAspectsResponseSchema.safeParse(body) : null;
      if (parsed?.success) setStartAspects({ status: "ready", aspects: parsed.data });
      else throw new Error("Tutor aspects are unavailable.");
    } catch {
      if (signal.aborted) return;
      // The same sketch is looked up again on the next request for it.
      lastKey.current = null;
      setStartAspects({ status: "failed" });
    } finally {
      if (pending.current?.controller === controller) pending.current = null;
    }
  }, [graphicsProfile]);

  const lookUp = useCallback((sketch: TutorStartAspectsSketch, force: boolean) => {
    const key = JSON.stringify([sketch, aspectPlanningRequestField()]);
    lastSketch.current = sketch;
    if (!force && key === lastKey.current) return;
    lastKey.current = key;
    cancel();
    setStartAspects((current) => (current.status === "ready" ? current : { status: "loading" }));
    const controller = new AbortController();
    const timer = setTimeout(() => void load(sketch, controller), LOOKUP_DELAY_MS);
    pending.current = { controller, timer };
  }, [cancel, load]);

  const refreshStartAspects = useCallback((sketch: TutorStartAspectsSketch) => lookUp(sketch, false), [lookUp]);

  // Another Example or course is another learning situation: its aspects are looked up anew.
  useEffect(() => {
    if (lastSketch.current) lookUp(lastSketch.current, true);
  }, [learningSituation, lookUp]);

  useEffect(() => cancel, [cancel]);

  return { startAspects, refreshStartAspects };
}

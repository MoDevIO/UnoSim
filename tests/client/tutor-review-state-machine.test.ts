import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import { tutorReviewExportSchema } from "@shared/tutor-review";
import { bindTutorDiagnosticResponse, reportTutorReviewAction, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";
import { clearTutorReview } from "@/lib/tutor-diagnostic-runtime";
import { buildTutorReviewExport } from "@/lib/tutor-review-export";
import { setTutorReviewCaptureEnabled, tutorReviewRuns } from "@/lib/tutor-review-store";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * The capture epoch as a state machine (Plan Aufgabe 6, LC-03): a request belongs to the epoch it started
 * in. Clear and DEBUG off/on end the epoch; a late result of an ended epoch adds neither a step nor a
 * display step, while a request of the new epoch is captured completely - also when the two interleave.
 * Single transitions are covered in `tutor-review-capture.test.ts`; this file covers their interleaving.
 */
const KEY = "sk-PRIVATE-STATE-MACHINE-KEY-0123456789";
const SKETCH = { code: "int counter = 0;\nvoid setup() { Serial.begin(9600); }\nvoid loop() { counter++; }", board: "uno" };

type Gate = { started: Promise<void>; release: () => void };
const pending = new Map<string, { markStarted: () => void; release: Promise<void> }>();

function gateFor(question: string): Gate {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  pending.set(question, { markStarted, release: released });
  return { started, release };
}

beforeEach(() => {
  localStorage.setItem("unoDebugMode", "1");
  clearTutorReview();
  setTutorReviewCaptureEnabled(true);
  pending.clear();
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { marker: string };
    const gate = pending.get(body.marker);
    if (gate) { gate.markStarted(); await gate.release; }
    return new Response(JSON.stringify({ provider: "kiconnect", model: "m", responseStyle: "normal", question: `Antwort auf ${body.marker}` }), { status: 200 });
  });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

/** One question request as use-tutor sends it, taken through parsing, binding and the display step. */
async function request(marker: string) {
  const response = await tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, marker, ...SKETCH }) });
  const payload: unknown = await response.json();
  const parsed = tutorResponseSchema.parse(payload);
  bindTutorDiagnosticResponse(payload, parsed);
  return parsed;
}
const start = (marker: string) => tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ credential: KEY, marker, ...SKETCH }) });
async function finish(pendingResponse: Promise<Response>) {
  const payload: unknown = await (await pendingResponse).json();
  const parsed = tutorResponseSchema.parse(payload);
  bindTutorDiagnosticResponse(payload, parsed);
  return parsed;
}
const recordOfLastRun = () => tutorReviewExportSchema.parse(parseTutorReviewExportJson(buildTutorReviewExport(tutorReviewRuns().at(-1)!).text));

describe("capture epoch interleavings", () => {
  it("Clear while A runs, B completes, then A arrives: the run holds exactly B, complete, and nothing of A", async () => {
    const gate = gateFor("A");
    const a = start("A");
    await gate.started;
    clearTutorReview();

    const fresh = await request("B");
    reportTutorReviewAction(fresh, "held");
    reportTutorReviewAction(fresh, "displayed");

    gate.release();
    const late = await finish(a);
    reportTutorReviewAction(late, "held");
    reportTutorReviewAction(late, "displayed");

    expect(tutorReviewRuns()).toHaveLength(1);
    const record = recordOfLastRun();
    expect(record.steps.map((step) => step.kind)).toEqual(["question", "held", "displayed"]);
    expect(record.steps[0]?.response?.question).toBe("Antwort auf B");
    expect(record.steps[0]?.status).toBe("completed");
    expect(JSON.stringify(record)).not.toContain("Antwort auf A");
    expect(JSON.stringify(record)).not.toContain(KEY);
  });

  it("DEBUG off/on while A runs, B completes, then A arrives: A stays an open step of the stopped run, B is complete in the new run", async () => {
    const gate = gateFor("A");
    const a = start("A");
    await gate.started;
    setTutorReviewCaptureEnabled(false);
    setTutorReviewCaptureEnabled(true);

    const fresh = await request("B");
    reportTutorReviewAction(fresh, "displayed");

    gate.release();
    const late = await finish(a);
    reportTutorReviewAction(late, "displayed");

    const runs = tutorReviewRuns();
    expect(runs).toHaveLength(2);
    const [old, current] = runs;
    expect(old?.status).toBe("stopped");
    expect(old?.steps.map((step) => step.kind)).toEqual(["question"]);
    expect(old?.steps[0]?.response).toBeUndefined();
    expect(current?.steps.map((step) => step.kind)).toEqual(["question", "displayed"]);
    expect(current?.steps[0]?.response?.question).toBe("Antwort auf B");
    expect(JSON.stringify(current)).not.toContain("Antwort auf A");
  });

  it("after Clear, later requests do not bring earlier steps back", async () => {
    await request("VOR DEM LEEREN 1");
    await request("VOR DEM LEEREN 2");
    expect(tutorReviewRuns().at(-1)?.steps).toHaveLength(2);
    clearTutorReview();
    expect(tutorReviewRuns()).toHaveLength(0);

    await request("DANACH");
    const record = recordOfLastRun();
    expect(record.steps).toHaveLength(1);
    expect(JSON.stringify(record)).not.toContain("VOR DEM LEEREN");
    expect(tutorReviewRuns()).toHaveLength(1);
  });
});

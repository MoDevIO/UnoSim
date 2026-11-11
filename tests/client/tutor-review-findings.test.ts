import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import { TUTOR_REVIEW_LIMITS, tutorReviewExportSchema, type TutorReviewServerEntry } from "@shared/tutor-review";
import { buildTutorReviewExport, TutorReviewExportTooLargeError } from "@/lib/tutor-review-export";
import {
  beginTutorReviewRequest, clearTutorReviewRuns, completeTutorReviewStep, receiveTutorReviewResponse, tutorReviewRuns,
} from "@/lib/tutor-review-store";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * Regressions from the independent check of the Tutor review (LearningQuestions 12.7): secrets, the export
 * limit, line-rich multi-file sketches, history matching, skip content, completeness and received blocks.
 */
type Endpoint = "question" | "dialog" | "support";
type Ids = { readonly traceId: string; readonly requestId: string };

function envelope(entries: TutorReviewServerEntry[], operation: string, extra: Record<string, unknown> = {}) {
  return (ids: Ids) => ({
    version: 1, ...ids, operation, promptRevision: { id: "tutor-prompts-v10", templateDigest: "a".repeat(64) },
    guidanceRevision: "assessment-guidance-v1", guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE },
    entries, dropped: 0, sanitized: 0, ...extra,
  });
}

/** One request through the store as the runtime records it; returns the step it produced. */
function record(endpoint: Endpoint, body: Record<string, unknown>, response: Record<string, unknown>, review?: (ids: Ids) => unknown) {
  const ids = { traceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
  const handle = beginTutorReviewRequest({ ...ids, endpoint, body: JSON.stringify(body) });
  receiveTutorReviewResponse(handle, { ok: true, body: response, review: review?.(ids), serverAvailable: true });
  completeTutorReviewStep(handle);
  return tutorReviewRuns().at(-1)?.steps.find((step) => step.requestId === ids.requestId);
}

const run = () => tutorReviewRuns().at(-1)!;
const exported = () => buildTutorReviewExport(run());
const recordOf = (text: string) => tutorReviewExportSchema.parse(parseTutorReviewExportJson(text));
const normal = (fields: Record<string, unknown>) => ({ responseStyle: "normal", model: "m", ...fields });

beforeEach(() => clearTutorReviewRuns());
afterEach(() => clearTutorReviewRuns());

describe("credentials", () => {
  it("removes a short credential from every kept text, course identifiers and history included", () => {
    // Six characters, not hexadecimal, so no random identifier can contain it by chance.
    const key = "k3y-Zq";
    const body = {
      code: `// ${key}\nvoid setup() {}`, credential: key, headers: [{ name: "secret.h", content: `#define KEY "${key}"` }],
      courseContent: { repository: `org/${key}`, ref: `branch-${key}`, revision: "abcdef0", exampleId: `ex-${key}` },
      question: `Frage ${key}?`, answer: `Antwort ${key}`,
      history: [{ question: `Alt ${key}?`, answer: "a", feedback: `f ${key}`, responseStyle: "normal" }],
    };
    record("question", { code: "void setup() {}", credential: key }, normal({ question: "Start?" }));
    record("dialog", body, normal({ question: `Weiter ${key}?`, feedback: `Rückmeldung ${key}`, answerRating: 3 }));
    // The store itself, before any export, holds no spelling of the key.
    expect(JSON.stringify(tutorReviewRuns())).not.toContain(key);
    expect(run().sanitized).toBeGreaterThanOrEqual(9);
    const text = exported().text;
    expect(text).not.toContain(key);
    expect(recordOf(text).steps[1].request?.courseContent?.ref).toBe("branch-[REDACTED-CREDENTIAL]");
  });
});

describe("redaction within field limits", () => {
  it("keeps a fully redacted maximal answer complete and valid for the export schema", () => {
    const key = "k3y-Zq";
    const answer = key.repeat(333); // 1,998 characters, within the answer limit
    record("question", { code: "void loop() {}", credential: key }, normal({ question: "Start?" }));
    record("dialog", { code: "void loop() {}", credential: key, question: "Start?", answer, history: [] }, normal({ question: "Weiter?", topicId: `t-${key}` }));
    const stored = run().steps[1];
    expect(JSON.stringify(tutorReviewRuns())).not.toContain(key);
    // Every occurrence is replaced and nothing is cut: 333 markers, no remainder.
    expect(stored.request?.answer).toBe("[REDACTED-CREDENTIAL]".repeat(333));
    const parsed = recordOf(exported().text);
    expect(parsed.steps[1].request?.answer).toHaveLength(333 * 21);
    expect(parsed.steps[1].response?.learning?.topicId).toBe("t-[REDACTED-CREDENTIAL]");
  });
});

describe("export size", () => {
  const variants: Record<string, (index: number) => string> = {
    "line separators": (index) => `//${index}${"\u2028".repeat(128_000)}`,
    "control characters": (index) => `//${index}${"\u0001".repeat(128_000)}`,
    "line breaks": (index) => `//${index}${"\n".repeat(128_000)}`,
  };

  for (const [name, code] of Object.entries(variants)) {
    it(`stops at the limit and never exports more than ${TUTOR_REVIEW_LIMITS.runBytes} bytes (${name})`, () => {
      for (let index = 0; index < 12; index++) record("question", { code: code(index), board: "uno" }, normal({ question: `Frage ${index}?` }));
      const result = exported();
      expect(result.bytes).toBeLessThanOrEqual(TUTOR_REVIEW_LIMITS.runBytes);
      // The reserved size bounds the real export from above, so the stop comes before the limit is passed.
      expect(run().estimatedBytes).toBeGreaterThanOrEqual(result.bytes);
      expect(run().status).toBe("stopped");
      expect(recordOf(result.text).capture.incompleteReasons).toContain("capture-limit");
    });
  }

  it("refuses to hand out a text above the limit instead of cutting it", () => {
    record("question", { code: "void setup() {}" }, normal({ question: "Klein?" }));
    // Bypasses the capture's reservation on purpose: only the final check stands between this run and the clipboard.
    run().contexts.push({ contextId: crypto.randomUUID(), code: "x".repeat(TUTOR_REVIEW_LIMITS.runBytes), headers: [] });
    expect(() => exported()).toThrow(TutorReviewExportTooLargeError);
  });
});

describe("line-rich multi-file sketch", () => {
  it("exports 100,000 code lines and twelve headers of 32,000 lines without exhausting the stack", () => {
    const headers = Array.from({ length: 12 }, (_, index) => ({ name: `part${index}.h`, content: "\n".repeat(32_000) }));
    record("question", { code: "\n".repeat(100_000), headers, board: "uno" }, normal({ question: "Viele Zeilen?" }));
    const result = exported();
    const parsed = recordOf(result.text);
    expect(parsed.contexts[0].headers).toHaveLength(12);
    expect(result.text).toContain("  part11.h:");
    expect(parsed.capture.complete).toBe(false); // no server review was attached
  });
});

describe("sent history", () => {
  const question = "Was zählt counter?";
  const answer = "Die Durchläufe.";
  const turn = (feedback: string, answerRating: number) => ({ question, answer, feedback, answerRating, responseStyle: "normal" });

  it("refers each sent turn to the step with the same feedback and rating, not to the first same question", () => {
    record("question", { code: "void loop() {}" }, normal({ question }));
    const weak = record("dialog", { code: "void loop() {}", question, answer, history: [] }, normal({ question, feedback: "Unvollständig.", answerRating: 2 }));
    const strong = record("dialog", { code: "void loop() {}", question, answer, history: [turn("Unvollständig.", 2)] }, normal({ question: "Nächste?", feedback: "Gut.", answerRating: 4 }));
    const later = record("dialog", { code: "void loop() {}", question: "Nächste?", answer: "x", history: [turn("Gut.", 4)] }, normal({ question: "Danach?" }));
    expect(strong?.request?.history).toEqual([{ stepId: weak!.stepId }]);
    expect(later?.request?.history).toEqual([{ stepId: strong!.stepId }]);
    expect(run().incomplete.has("capture-started-late")).toBe(false);
  });

  it("keeps an entry that matches two steps verbatim instead of guessing, without calling it pre-capture history", () => {
    record("question", { code: "void loop() {}" }, normal({ question }));
    record("dialog", { code: "void loop() {}", question, answer, history: [] }, normal({ question, feedback: "Gleich.", answerRating: 3 }));
    record("dialog", { code: "void loop() {}", question, answer, history: [] }, normal({ question, feedback: "Gleich.", answerRating: 3 }));
    const sent = record("dialog", { code: "void loop() {}", question, answer: "y", history: [turn("Gleich.", 3)] }, normal({ question: "Weiter?" }));
    const imported = run().importedHistory;
    expect(imported).toEqual([{ importId: expect.any(String), ...turn("Gleich.", 3), reason: "ambiguous" }]);
    expect(sent?.request?.history).toEqual([{ importId: imported[0].importId }]);
    expect(run().incomplete.has("capture-started-late")).toBe(false);
    expect(exported().text).toContain("Eintrag ohne eindeutigen Schritt");
  });
});

describe("server review completeness", () => {
  it("calls a run incomplete when the server dropped review entries or left out the sketch facts", () => {
    record("question", { code: "void loop() {}" }, normal({ question: "A?" }), envelope([], "question", { dropped: 1 }));
    const first = recordOf(exported().text).capture;
    expect(first.complete).toBe(false);
    expect(first.incompleteReasons).toEqual(["server-review-truncated"]);
    expect(exported().text).toContain("vollständig: nein (server-review-truncated)");

    clearTutorReviewRuns();
    record("question", { code: "void loop() {}" }, normal({ question: "B?" }), envelope([{ kind: "facts", omitted: "too-large" }], "question"));
    expect(recordOf(exported().text).capture.incompleteReasons).toEqual(["server-review-truncated"]);
  });

  it("rejects a received block above 128 KiB as invalid and keeps the delivered learning content", () => {
    const drafts: TutorReviewServerEntry[] = Array.from({ length: 64 }, (_, attempt) => ({ kind: "draft", attempt, mermaid: "m".repeat(12_000) }));
    const step = record("question", { code: "void loop() {}" }, normal({ question: "Groß?" }), envelope(drafts, "question"));
    expect(step?.server).toEqual({ status: "invalid", entries: [] });
    expect(step?.response?.question).toBe("Groß?");
    expect(run().incomplete.has("review-invalid")).toBe(true);
  });

  it("redacts the credential inside received rule texts before keeping them", () => {
    const key = "PRIVATE-GUIDANCE-KEY-77";
    const guidance = { ratingRubric: `Rubrik mit ${key}`, difficultyGuidance: "Schwierigkeit v9" };
    record("question", { code: "void loop() {}", credential: key }, normal({ question: "R?" }), envelope([], "question", { guidanceRevision: "guide-9", guidance }));
    expect(run().guidanceSets).toEqual([{ guidanceRevision: "guide-9", ratingRubric: "Rubrik mit [REDACTED-CREDENTIAL]", difficultyGuidance: "Schwierigkeit v9" }]);
    expect(run().sanitized).toBe(1);
    expect(exported().text).not.toContain(key);
  });

  it("names rule sets beyond the limit as missing and calls the run incomplete", () => {
    for (let index = 0; index <= TUTOR_REVIEW_LIMITS.guidanceSets; index++) {
      const guidance = { ratingRubric: `Rubrik ${index}`, difficultyGuidance: `Schwierigkeit ${index}` };
      record("question", { code: "void loop() {}" }, normal({ question: `G${index}?` }), envelope([], "question", { guidanceRevision: `guide-${index}`, guidance }));
    }
    const { text } = exported();
    const parsed = recordOf(text);
    expect(parsed.legend.serverSets).toHaveLength(TUTOR_REVIEW_LIMITS.guidanceSets);
    expect(parsed.legend.missingServerSets).toEqual([`guide-${TUTOR_REVIEW_LIMITS.guidanceSets}`]);
    expect(parsed.capture.complete).toBe(false);
    expect(parsed.capture.incompleteReasons).toContain("capture-limit");
    expect(text).toContain(`Regeln guide-${TUTOR_REVIEW_LIMITS.guidanceSets} (Regeltexte nicht erfasst: Grenze erreicht)`);
  });

  it("lists every missing rule set up to the request limit and stays valid", () => {
    for (let index = 0; index < TUTOR_REVIEW_LIMITS.requestAttempts; index++) {
      const guidance = { ratingRubric: `Rubrik ${index}`, difficultyGuidance: `Schwierigkeit ${index}` };
      record("question", { code: "void loop() {}" }, normal({ question: `H${index}?` }), envelope([], "question", { guidanceRevision: `guide-${index}`, guidance }));
    }
    const parsed = recordOf(exported().text);
    const missing = TUTOR_REVIEW_LIMITS.requestAttempts - TUTOR_REVIEW_LIMITS.guidanceSets;
    expect(parsed.legend.missingServerSets).toHaveLength(missing);
    // Every step names a revision whose texts are kept or listed as missing.
    const known = new Set([...parsed.legend.serverSets.map((set) => set.guidanceRevision), ...parsed.legend.missingServerSets]);
    expect(parsed.steps.every((step) => !step.server?.guidanceRevision || known.has(step.server.guidanceRevision))).toBe(true);
  });

  it("confirms the legend only for a complete, matching server block", () => {
    record("question", { code: "void loop() {}" }, normal({ question: "C?" }), envelope([], "question"));
    const parsed = recordOf(exported().text);
    expect(parsed.capture.complete).toBe(true);
    expect(parsed.legend).toMatchObject({ confirmation: "confirmed-by-server", serverSets: [] });
  });
});

describe("code contexts beyond the request limits", () => {
  const header = (index: number, content = "int x;") => ({ name: `h${index}.h`, content });
  for (const [name, body] of [
    ["25 headers", { code: "void loop() {}", headers: Array.from({ length: 25 }, (_, index) => header(index)) }],
    ["an entry file name of 3,000 characters", { code: "void loop() {}", entryFile: `${"e".repeat(3_000)}.ino` }],
    ["a header name above the limit", { code: "void loop() {}", headers: [{ name: `${"n".repeat(200)}.h`, content: "x" }] }],
    ["a header content above the limit", { code: "void loop() {}", headers: [header(0, "x".repeat(40_000))] }],
    ["code above the limit", { code: "x".repeat(140_000) }],
  ] as const) {
    it(`records the step without a context, incomplete and schema-valid (${name})`, () => {
      const step = record("question", body, normal({ question: "Q?" }));
      expect(step?.contextId).toBeUndefined();
      expect(run().contexts).toEqual([]);
      expect(step?.response?.question).toBe("Q?");
      const parsed = recordOf(exported().text);
      expect(parsed.capture.incompleteReasons).toContain("capture-limit");
    });
  }

  it("still records a context at exactly the limits", () => {
    const headers = Array.from({ length: 20 }, (_, index) => header(index, "x".repeat(32 * 1024)));
    const step = record("question", { code: "x".repeat(128 * 1024), entryFile: `${"e".repeat(124)}.ino`, headers }, normal({ question: "Q?" }));
    expect(step?.contextId).toBeDefined();
    recordOf(exported().text);
  });
});

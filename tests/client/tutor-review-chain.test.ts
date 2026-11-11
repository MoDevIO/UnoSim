import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import {
  redactTutorReviewText, TUTOR_REVIEW_LIMITS, TUTOR_REVIEW_REDACTED, tutorReviewExportSchema, type TutorReviewServerEntry,
} from "@shared/tutor-review";
import { getTutorReview, reportTutorReview, withTutorDiagnostics } from "../../server/services/tutor/tutor-diagnostics";
import { bindTutorDiagnosticResponse, reportTutorReviewAction, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";
import { clearTutorReview } from "@/lib/tutor-diagnostic-runtime";
import { buildTutorReviewExport } from "@/lib/tutor-review-export";
import { beginTutorReviewRequest, tutorReviewRuns } from "@/lib/tutor-review-store";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * The redaction chain of the Tutor review (LearningQuestions 12.7) end to end: the server collector redacts
 * and validates its block, JSON carries it, the browser runtime redacts again, and the export validates.
 */
const PROMPT = { id: "tutor-prompts-v10", templateDigest: "a".repeat(64) };
let serverEntries: TutorReviewServerEntry[] = [];
let responseBody: Record<string, unknown> = {};

beforeEach(() => {
  localStorage.setItem("unoDebugMode", "1");
  clearTutorReview();
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const credential = JSON.parse(String(init?.body)).credential as string;
    // The server's own collector builds the block, with the credential of this request.
    const review = withTutorDiagnostics({
      traceId: headers.get("x-unosim-tutor-trace-id")!, requestId: headers.get("x-request-id")!, operation: "question", credential,
    }, () => {
      for (const entry of serverEntries) reportTutorReview(entry);
      return getTutorReview(PROMPT);
    });
    return new Response(JSON.stringify({ ...responseBody, review }), { status: 200 });
  });
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); clearTutorReview(); });

async function ask(credential: string) {
  const response = await tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ code: "void loop() {}", credential }) });
  const payload: unknown = await response.json();
  const parsed = tutorResponseSchema.parse(payload);
  bindTutorDiagnosticResponse(payload, parsed);
  return parsed;
}

const exported = () => {
  const { text } = buildTutorReviewExport(tutorReviewRuns().at(-1)!);
  return { text, record: tutorReviewExportSchema.parse(parseTutorReviewExportJson(text)) };
};

describe("redaction chain from collector to export", () => {
  it("keeps a maximal draft made only of a short key, redacted once and valid in every contract", async () => {
    const key = "k3y-Zq";
    const question = key.repeat(333); // 1,998 characters, a valid draft
    serverEntries = [{ kind: "draft", attempt: 1, responseStyle: "normal", question }];
    responseBody = { provider: "kiconnect", model: "m", responseStyle: "normal", question };
    await ask(key);
    const { text, record } = exported();
    const server = record.steps[0].server!;
    expect(server.dropped).toBe(0);
    expect(server.entries[0]).toMatchObject({ kind: "draft", question: TUTOR_REVIEW_REDACTED.repeat(333) });
    expect(record.steps[0].response?.question).toBe(TUTOR_REVIEW_REDACTED.repeat(333));
    expect(text).not.toContain(key);
  });

  it("does not grow the marker again for a key that occurs inside the marker", async () => {
    const key = "ED"; // "[REDACTED-CREDENTIAL]" contains it twice
    serverEntries = [{ kind: "draft", attempt: 1, responseStyle: "normal", question: key.repeat(70) }];
    responseBody = { provider: "kiconnect", model: "m", responseStyle: "normal", question: key.repeat(1_000) };
    await ask(key);
    const { record } = exported();
    // Server pass, browser pass and the response's double pass all give one marker per occurrence.
    expect(record.steps[0].server?.entries[0]).toMatchObject({ question: TUTOR_REVIEW_REDACTED.repeat(70) });
    expect(record.steps[0].response?.question).toBe(TUTOR_REVIEW_REDACTED.repeat(1_000));
    expect(record.steps[0].server?.dropped).toBe(0);
  });
});

describe("redaction properties", () => {
  const keys = ["ED", "E", "[RED", "L]", "]x", "L]X", "k3y-Zq", " ED ", "a\"b", "ä ö"];
  const texts = ["", "plain", "ED ED", `${TUTOR_REVIEW_REDACTED}ED`, "L]XX", "x]xL]X]x", "[RED[RED", String.raw`a\"b a%22b`, "ä ö ä%20ö"];

  for (const key of keys) {
    it(`is idempotent, bounded and leaves no spelling outside a marker (${JSON.stringify(key)})`, () => {
      for (const value of texts) {
        const once = redactTutorReviewText(value, key);
        const twice = redactTutorReviewText(once.text, key);
        expect(twice).toEqual({ text: once.text, count: 0 });
        expect(once.text.length).toBeLessThanOrEqual(Math.max(value.length, 1) * TUTOR_REVIEW_REDACTED.length);
        // Outside markers no spelling of the key remains.
        expect(once.text.split(TUTOR_REVIEW_REDACTED).join("\u0000")).not.toContain(key.trim());
      }
    });
  }

  it("turns a text into one marker where a key would show across a marker's edge", () => {
    expect(redactTutorReviewText("L]XX", "L]X")).toEqual({ text: TUTOR_REVIEW_REDACTED, count: 2 });
  });
});

describe("local display actions after Clear", () => {
  it("records no held step for a response whose request was not captured and ended with Clear", async () => {
    // Fill the run to its request limit, so the next request runs without a review handle.
    for (let index = 0; index < TUTOR_REVIEW_LIMITS.requestAttempts; index++) {
      beginTutorReviewRequest({ traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), endpoint: "question", body: "{}" });
    }
    serverEntries = [];
    responseBody = { provider: "kiconnect", model: "m", responseStyle: "normal", question: "Spät?" };
    const response = await tutorDiagnosticFetch("/api/tutor/question", { method: "POST", body: JSON.stringify({ code: "void loop() {}", credential: "k" }) });
    clearTutorReview();
    const payload: unknown = await response.json();
    const parsed = tutorResponseSchema.parse(payload);
    bindTutorDiagnosticResponse(payload, parsed);
    reportTutorReviewAction(parsed, "held");
    reportTutorReviewAction(parsed, "displayed");
    expect(tutorReviewRuns()).toEqual([]);
  });
});

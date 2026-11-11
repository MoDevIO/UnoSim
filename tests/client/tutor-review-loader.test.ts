import { afterEach, expect, it, vi } from "vitest";
import { tutorResponseSchema } from "@shared/tutor";
import { clearTutorReview, reportTutorReviewAction, reportTutorReviewReset, tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";

vi.mock("@/lib/tutor-diagnostic-runtime", () => { throw new Error("PRIVATE_LOADER_DETAIL"); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

/** Without the optional runtime, a `review` block must not reach the strict learning schema (LearningQuestions 12.7). */
it("drops the review block and keeps the learning content when the runtime cannot load", async () => {
  localStorage.setItem("unoDebugMode", "1");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    provider: "kiconnect", model: "m", responseStyle: "normal", question: "Welche Funktion beginnt?",
    review: { version: 1, entries: [{ kind: "draft", question: "PRIVATE_DRAFT" }] }, diagnostics: { events: [] },
  }), { status: 200 }));
  const body = await (await tutorDiagnosticFetch("/api/tutor/question", { method: "POST" })).json();
  expect(body).not.toHaveProperty("review");
  expect(body).not.toHaveProperty("diagnostics");
  const question = tutorResponseSchema.parse(body);
  expect(question.question).toBe("Welche Funktion beginnt?");
  // The local review hooks stay harmless without the runtime.
  expect(() => { reportTutorReviewAction(question, "held"); reportTutorReviewReset(); clearTutorReview(); }).not.toThrow();
});

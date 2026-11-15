import { afterEach, expect, it } from "vitest";
import { TUTOR_DIFFICULTY_GUIDANCE, TUTOR_RATING_RUBRIC } from "@shared/tutor-assessment-guidance";
import { beginTutorReviewRequest, clearTutorReviewRuns, completeTutorReviewStep, receiveTutorReviewResponse, tutorReviewRuns } from "@/lib/tutor-review-store";
import { buildTutorReviewExport } from "@/lib/tutor-review-export";

afterEach(() => { clearTutorReviewRuns(); localStorage.clear(); });
it("keeps mode, delivery status and redacted graphic decisions in the copied review", () => {
  localStorage.setItem("unoDebugMode", "1");
  clearTutorReviewRuns();
  const ids = { traceId: crypto.randomUUID(), requestId: crypto.randomUUID() };
  const handle = beginTutorReviewRequest({ ...ids, endpoint: "question", body: JSON.stringify({ code: "void loop(){}", graphicsMode: "always", credential: "private-key" }) });
  receiveTutorReviewResponse(handle, { ok: true, serverAvailable: true,
    body: { question: "Frage?", graphicStatus: "unavailable" },
    review: { ...ids, version: 1, operation: "question", promptRevision: { id: "tutor-prompts-v11", templateDigest: "a".repeat(64) },
      guidanceRevision: "assessment-guidance-v1", guidance: { ratingRubric: TUTOR_RATING_RUBRIC, difficultyGuidance: TUTOR_DIFFICULTY_GUIDANCE },
      entries: [{ kind: "graphic", mode: "always", state: "failed", attempt: 1, question: "Frage private-key?", promptRevision: "tutor-question-graphic-v1", reason: "provider-timeout" }], dropped: 0, sanitized: 0 },
  });
  completeTutorReviewStep(handle);
  const run = tutorReviewRuns().at(-1)!;
  expect(run.steps[0].request?.graphicsMode).toBe("always");
  expect(run.steps[0].response?.graphicStatus).toBe("unavailable");
  expect(run.steps[0].server?.entries).toEqual([expect.objectContaining({ kind: "graphic", state: "failed", question: "Frage [REDACTED-CREDENTIAL]?" })]);
  const exported = buildTutorReviewExport(run);
  expect(exported.text).toContain("Grafikmodus: always");
  expect(exported.text).toContain("Grafikstatus: unavailable");
  expect(exported.text).not.toContain("private-key");
});

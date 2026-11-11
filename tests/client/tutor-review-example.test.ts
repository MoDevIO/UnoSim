import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tutorReviewExportSchema } from "@shared/tutor-review";
import { parseTutorReviewExportJson } from "./tutor-review-test-utils";

/**
 * The documented example export (docs/tutor-review-format.md) comes from a controlled browser run. Its JSON
 * must keep validating, and its readable parts must agree with the JSON, so the format description stays true.
 */
const text = readFileSync(resolve(__dirname, "../../docs/examples/tutor-review-example.txt"), "utf8");
const record = tutorReviewExportSchema.parse(parseTutorReviewExportJson(text));

describe("Tutor review example export", () => {
  it("validates against the export schema and ends with its own closing marker", () => {
    expect(record.formatVersion).toBe(1);
    expect(text.trimEnd().endsWith(`=== ENDE UnoSim Tutor-Review v1 · runId ${record.runId} ===`)).toBe(true);
  });

  it("states the same counts in its header as in its JSON", () => {
    const openSteps = record.steps.filter((step) => step.status === "open").length;
    const steps = record.steps.filter((step) => step.kind !== "rating-summary").length;
    expect(text).toContain(`Umfang: ${steps} Schritte (${openSteps} offen), ${record.capture.requestAttempts} Requests, ${record.steps.filter((step) => step.kind === "answer").length} Antworten`);
    expect(text).toContain(`${record.contexts.length} Kontextstände`);
    expect(text).toContain(`Mitschnitt: ${record.runId}`);
    expect(text).toContain(`Größe: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KiB`);
  });

  it("shows every answer, rating and code context of the JSON in the readable protocol", () => {
    for (const step of record.steps.filter((candidate) => candidate.kind === "answer")) {
      expect(text).toContain(`  | ${step.request!.answer!.split("\n")[0]}`);
      expect(text).toContain(`Bewertung: ${step.response!.answerRating}/5`);
    }
    for (const context of record.contexts) expect(text).toContain(`contextId ${context.contextId}`);
  });
});

import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState } from "../../../../server/services/tutor/curriculum/progression-state";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { getTutorDiagnostics, withTutorDiagnostics } from "../../../../server/services/tutor/tutor-diagnostics";

it.each([true, false])("reports final graphic ownership after planner acceptance (invalid plan: %s)", async (invalid) => {
  const mermaid = "flowchart LR\nA --> B";
  const service = new TutorService({ async listModels() { return ["m"]; }, async generateLearningQuestion() { return { model: "m", result: { responseStyle: "normal" as const, question: "Einzelne Providerfrage?", mermaid } }; } }, new CurriculumTutorAdapter());
  const revision = "2".repeat(40);
  const content = {
    revision, progressionState: createTutorProgressionState(revision),
    tutor: { status: "valid" as const, manifest: { schemaVersion: 1 as const, topics: [], strategies: [] }, topics: [], strategies: [] },
    exampleId: "example", exampleTutorAnnotation: { schemaVersion: 2 as const, focus: [{ id: "pin", title: "Pin", objective: "Den Pin verstehen.", questions: [{ kind: "concept" as const, text: invalid ? "Was tut `pinMode`? Und was tut `digitalWrite`?" : "Welche Aufgabe hat `pinMode` für Pin 13?" }] }] },
  };
  await withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "question" }, async () => {
    const delivered = await service.generateQuestion("void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);}", "key", "m", 30, content);
    const decisions = getTutorDiagnostics()!.events.filter((event) => event.stage === "content");
    if (invalid) {
      expect(delivered.result.mermaid).toBe(mermaid);
      expect(decisions.some((event) => event.outcome === "discarded")).toBe(false);
      expect(decisions.some((event) => event.outcome === "accepted")).toBe(true);
    } else {
      expect(delivered.result.mermaid).toBeUndefined();
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ outcome: "discarded", reason: "question-replaced" });
    }
  });
});

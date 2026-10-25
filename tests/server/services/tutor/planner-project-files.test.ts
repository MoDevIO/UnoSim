import { describe, expect, it, vi } from "vitest";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import type { TutorPlanningExtension } from "../../../../server/services/tutor/tutor-planning";
import { resolveEffectiveTutorStrategy } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";

/** The deterministic topic selection reads the facts of the whole project, not of the entry file alone. */
describe("Tutor planner sees the files of the project", () => {
  const code = '#include "values.h"\nvoid setup() {}\nvoid loop() {}';
  const headers = [{ name: "values.h", content: "int values[] = {1, 2, 3};" }];
  const source = { board: "uno" as const, headers };
  const facts = new DefaultSketchFactExtractor();

  function service() {
    const planning: TutorPlanningExtension = {
      resolveStrategy: vi.fn().mockResolvedValue(resolveEffectiveTutorStrategy({})),
      planInitial: vi.fn().mockResolvedValue(null),
      planFollowup: vi.fn().mockResolvedValue(null),
      planAnswered: vi.fn().mockResolvedValue(null),
    } as unknown as TutorPlanningExtension;
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: { question: "Wie viele Elemente hat das Feld values?", responseStyle: "normal", answerRating: 4 },
      }),
    };
    return { planning, instance: new TutorService(provider, planning) };
  }

  it("hands the planner the project text for a new question: the array of the header is a fact", async () => {
    const { planning, instance } = service();

    await instance.generateQuestion(code, "key", undefined, 30, undefined, undefined, source);

    const planned = (planning.planInitial as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].code as string;
    expect(facts.extract(code).arrays).toEqual([]);
    expect(facts.extract(planned).arrays).toEqual([{ name: "values", elementType: "int", elementCount: 3 }]);
  });

  it("hands the project text to the strategy and to the planning of a dialog turn", async () => {
    const { planning, instance } = service();

    await instance.generateDialogResponse(code, [], "Wie viele Elemente hat values?", "Drei Elemente.", "key", undefined, 30, undefined, undefined, source);

    for (const method of ["resolveStrategy", "planAnswered", "planFollowup"] as const) {
      const call = (planning[method] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { code: string };
      expect(call.code, method).toContain("int values[] = {1, 2, 3};");
    }
  });

  it("leaves a lone sketch unchanged", async () => {
    const { planning, instance } = service();

    await instance.generateQuestion(code, "key", undefined, 30);

    expect((planning.planInitial as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].code).toBe(code);
  });
});

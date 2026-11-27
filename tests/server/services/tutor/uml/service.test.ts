import { describe, expect, it } from "vitest";
import {
  prepareTutorUml,
  serializeTutorDiagram,
} from "../../../../../server/services/tutor/uml/service";
import { withTutorUmlArtifacts } from "./artifact-scope";
import { TutorUmlArtifacts } from "../../../../../server/services/tutor/uml/artifacts";
import type { TutorUmlDiagram } from "@shared/tutor-uml";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

const proposal = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "activity",
  purpose: "Zeigt die Schritte der Funktion für den Vergleich.",
  scope: { file: "main.ino", startLine: 1, endLine: 3 },
  body: [
    {
      type: "action",
      code: "x++;",
      ref: { file: "main.ino", startLine: 2, endLine: 2 },
    },
  ],
};
const context = {
  question: "Welche Anweisung folgt auf den Aufruf von arbeiten?",
  code: "void arbeiten() {\n x++;\n}",
  entryFile: "main.ino",
  board: "uno",
};
const image = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>',
  width: 100,
  height: 100,
  bytes: 74,
  rendererRevision: "test-v1",
};
function setup(available = true) {
  const renders: string[] = [];
  const provider: LLMProvider = {
    listModels: async () => [],
    generateLearningQuestion: async () => {
      throw Error("unexpected primary");
    },
  };
  const renderer = {
    available: async () => available,
    render: async (source: string) => {
      renders.push(source);
      return image;
    },
  };
  return {
    provider,
    renderer,
    renders,
    artifacts: new TutorUmlArtifacts<TutorUmlDiagram>(),
  };
}
describe("final question UML preparation", () => {
  it("without a proposal of the model there is no diagram and nothing is rendered", async () => {
    const s = setup();
    const result = await prepareTutorUml(context, { ...s });
    expect(result.graphicStatus).toBeUndefined();
    expect(s.renders).toHaveLength(0);
  });
  it("a valid proposal is rendered and bound to its owner", async () => {
    const s = setup();
    await withTutorUmlArtifacts("owner", undefined, async () => {
      const result = await prepareTutorUml(context, { ...s, proposal });
      expect(result.graphicStatus).toBe("provided");
      expect(result.diagram?.image).toBeUndefined();
      const wire = serializeTutorDiagram({ ...result }, "owner", s.artifacts);
      expect(wire).not.toHaveProperty("_diagramArtifact");
      expect(wire.diagram?.image?.svg).toBe(image.svg);
      expect(
        serializeTutorDiagram({ ...result }, "other", s.artifacts).diagram,
      ).toBeUndefined();
    });
    expect(s.renders).toHaveLength(1);
  });
  it("a rejected proposal is unavailable and never asked for again", async () => {
    const s = setup();
    const result = await prepareTutorUml(context, {
      ...s,
      proposal: { invalid: true },
    });
    expect(result.graphicStatus).toBe("unavailable");
    expect(s.renders).toHaveLength(0);
  });
  it("a not-useful proposal stops without render", async () => {
    const s = setup();
    const result = await prepareTutorUml(context, {
      ...s,
      proposal: {
        version: 1,
        profile: "uml1-classic-v1",
        status: "not-useful",
        reason: "no-useful-context",
        explanation: "Keine zusätzliche Hilfe.",
      },
    });
    expect(result.graphicStatus).toBe("not-useful");
    expect(s.renders).toHaveLength(0);
  });
  it("a missing renderer leaves a valid proposal unavailable", async () => {
    const s = setup(false);
    const result = await prepareTutorUml(context, { ...s, proposal });
    expect(result.graphicStatus).toBe("unavailable");
    expect(s.renders).toHaveLength(0);
  });
  it("a valid primary proposal renders", async () => {
    const s = setup();
    const result = await prepareTutorUml(context, {
      ...s,
      proposal,
    });
    expect(result.graphicStatus).toBe("provided");
    expect(s.renders).toHaveLength(1);
    s.artifacts.release(result._diagramArtifact!);
  });
});

describe("Tutor service profile integration", () => {
  it("isolates the primary proposal and keeps the selected final question", async () => {
    const { TutorService } =
      await import("../../../../../server/services/tutor/tutor-service");
    const primary: unknown[] = [];
    const s = setup();
    s.provider.generateLearningQuestion = async (request) => {
      primary.push(request);
      request.onModelSelected?.("actual-callable");
      return {
        model: "response-label",
        result: { question: context.question, responseStyle: "normal" },
        diagramProposal: proposal,
      };
    };
    const service = new TutorService(s.provider, undefined, {
      renderer: s.renderer,
      artifacts: s.artifacts,
    });
    const result = await service.generateQuestion(
      context.code,
      "key",
      undefined,
      40,
      undefined,
      undefined,
      { entryFile: "main.ino" },
      "uml1-classic-v1",
    );
    expect(result.result.question).toBe(context.question);
    expect(result.result.graphicStatus).toBe("provided");
    expect(result.result.diagram?.image).toBeUndefined();
    expect(primary[0]).toMatchObject({
      systemPrompt: expect.stringContaining("UML-Zusatz"),
    });
  });
});

it("full owner capacity leaves the proposal unrendered and preserves text availability", async () => {
  const s = setup();
  const held = [];
  for (;;) {
    const reservation = s.artifacts.reserve("owner");
    if (!reservation) break;
    held.push(reservation);
  }
  await withTutorUmlArtifacts("owner", undefined, async () => {
    const result = await prepareTutorUml(context, { ...s, proposal });
    expect(result.graphicStatus).toBe("unavailable");
    expect(s.renders).toHaveLength(0);
  });
  for (const token of held) s.artifacts.release(token);
});
it("abort during rendering releases the reservation and never returns a diagram", async () => {
  const s = setup();
  const abort = new AbortController();
  const renderer = {
    available: async () => true,
    render: async () => {
      abort.abort();
      return image;
    },
  };
  await expect(
    withTutorUmlArtifacts("owner", undefined, () =>
      prepareTutorUml(context, {
        ...s,
        renderer,
        proposal,
        signal: abort.signal,
      }),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  const pins = [];
  for (;;) {
    const pin = s.artifacts.reserve("owner");
    if (!pin) break;
    pins.push(pin);
  }
  expect(pins).toHaveLength(15);
  for (const pin of pins) s.artifacts.release(pin);
});
it("request-finally releases an unadopted rendered artifact", async () => {
  const s = setup();
  const result = await withTutorUmlArtifacts("owner", undefined, () =>
    prepareTutorUml(context, {
      ...s,
      proposal,
    }),
  );
  expect(s.artifacts.wireDiagram(result._diagramArtifact!, "owner")).toBeNull();
});
it("renderer failures preserve the valid question", async () => {
  const s = setup();
  const { TutorService } =
    await import("../../../../../server/services/tutor/tutor-service");
  s.provider.generateLearningQuestion = async () => ({
    model: "m",
    result: { question: context.question, responseStyle: "normal" },
    diagramProposal: proposal,
  });
  const service = new TutorService(s.provider, undefined, {
    artifacts: s.artifacts,
    renderer: {
      available: async () => true,
      render: async () => {
        throw new Error("private renderer output");
      },
    },
  });
  const result = await service.generateQuestion(
    context.code,
    "key",
    undefined,
    40,
    undefined,
    undefined,
    { entryFile: "main.ino" },
    "uml1-classic-v1",
  );
  expect(result.result).toMatchObject({
    question: context.question,
    graphicStatus: "unavailable",
  });
  expect(JSON.stringify(result)).not.toContain("private renderer output");
});
it("the primary profile prompt identifies the actual entry and separate headers", async () => {
  const s = setup();
  let prompt = "";
  s.provider.generateLearningQuestion = async (request) => {
    prompt = request.userPrompt;
    return {
      model: "m",
      result: { question: context.question, responseStyle: "normal" },
    };
  };
  const { TutorService } =
    await import("../../../../../server/services/tutor/tutor-service");
  await new TutorService(s.provider).generateQuestion(
    context.code,
    "key",
    undefined,
    40,
    undefined,
    undefined,
    {
      entryFile: "main.ino",
      headers: [{ name: "helper.h", content: "int helper;" }],
    },
    "uml1-classic-v1",
  );
  expect(prompt).toContain('"entryFile":"main.ino"');
  expect(prompt).toContain('{"file":"helper.h","lines":["1| int helper;"]}');
  expect(prompt).toContain('{"file":"main.ino","lines":["1| void arbeiten() {","2|  x++;","3| }"]}');
});
it("a planner replacement discards the primary proposal of the replaced question", async () => {
  const s = setup();
  const { TutorService } =
    await import("../../../../../server/services/tutor/tutor-service");
  const { CurriculumTutorAdapter } =
    await import("../../../../../server/services/tutor/curriculum-tutor-adapter");
  const { createTutorProgressionState } =
    await import("../../../../../server/services/tutor/curriculum/progression-state");
  const finalQuestion = "Welche Rolle hat die Reihenfolge in arbeiten?";
  s.provider.generateLearningQuestion = async (request) => {
    request.onModelSelected?.("actual-alias");
    return {
      model: "version-label",
      result: { question: context.question, responseStyle: "normal" },
      diagramProposal: proposal,
    };
  };
  const revision = "a".repeat(40);
  const content = {
    revision,
    progressionState: createTutorProgressionState(revision),
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics: [],
      strategies: [],
    },
    exampleId: "example",
    exampleTutorAnnotation: {
      schemaVersion: 2 as const,
      focus: [
        {
          id: "order",
          title: "Reihenfolge",
          objective: "Die Reihenfolge verstehen.",
          questions: [{ kind: "concept" as const, text: finalQuestion }],
        },
      ],
    },
  };
  const service = new TutorService(s.provider, new CurriculumTutorAdapter(), {
    renderer: s.renderer,
    artifacts: s.artifacts,
  });
  const response = await service.generateQuestion(
    context.code,
    "key",
    undefined,
    40,
    content,
    undefined,
    { entryFile: "main.ino" },
    "uml1-classic-v1",
  );
  expect(response.result.question).toBe(finalQuestion);
  expect(response.followUpSource).toBe("planner");
  expect(response.result.diagram).toBeUndefined();
  expect(s.renders).toHaveLength(0);
});
it("an aborted renderer leaves progression uncommitted", async () => {
  const s = setup();
  const controller = new AbortController();
  const { TutorService } =
    await import("../../../../../server/services/tutor/tutor-service");
  const { CurriculumTutorAdapter } =
    await import("../../../../../server/services/tutor/curriculum-tutor-adapter");
  const { createTutorProgressionState } =
    await import("../../../../../server/services/tutor/curriculum/progression-state");
  const revision = "a".repeat(40);
  const content = {
    revision,
    progressionState: createTutorProgressionState(revision),
    tutor: {
      status: "valid" as const,
      manifest: { schemaVersion: 1 as const, topics: [], strategies: [] },
      topics: [],
      strategies: [],
    },
    exampleId: "example",
    exampleTutorAnnotation: {
      schemaVersion: 2 as const,
      focus: [
        {
          id: "order",
          title: "Reihenfolge",
          objective: "Die Reihenfolge verstehen.",
          questions: [{ kind: "concept" as const, text: context.question }],
        },
      ],
    },
  };
  const before = structuredClone(content.progressionState);
  s.provider.generateLearningQuestion = async () => ({
    model: "m",
    result: { question: context.question, responseStyle: "normal" },
    diagramProposal: proposal,
  });
  const service = new TutorService(s.provider, new CurriculumTutorAdapter(), {
    renderer: {
      available: async () => true,
      render: async () => {
        controller.abort();
        return image;
      },
    },
    artifacts: s.artifacts,
  });
  await expect(
    withTutorUmlArtifacts("owner", undefined, () =>
      service.generateQuestion(
        context.code,
        "key",
        undefined,
        40,
        content,
        controller.signal,
        { entryFile: "main.ino" },
        "uml1-classic-v1",
      ),
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(content.progressionState).toEqual(before);
});
it("cancellation releases artifact capacity while an uncooperative renderer is still pending", async () => {
  const s = setup();
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: (value: typeof image) => void;
  const renderer = {
    available: async () => true,
    render: async () => {
      entered();
      return new Promise<typeof image>((resolve) => {
        finish = resolve;
      });
    },
  };
  const pending = prepareTutorUml(context, {
    ...s,
    renderer,
    proposal,
    signal: controller.signal,
  });
  const rejected = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await started;
  controller.abort();
  const pins = [];
  for (;;) {
    const pin = s.artifacts.reserve(undefined);
    if (!pin) break;
    pins.push(pin);
  }
  try {
    expect(pins).toHaveLength(120);
  } finally {
    finish(image);
    for (const pin of pins) s.artifacts.release(pin);
    await rejected;
  }
});
it("the dialog primary prompt preserves exact entry code and separate header references", async () => {
  const s = setup();
  let prompt = "";
  s.provider.generateLearningQuestion = async (request) => {
    prompt = request.userPrompt;
    return {
      model: "m",
      result: {
        question: "Welche Rolle hat die Reihenfolge in arbeiten?",
        responseStyle: "normal",
        answerRating: 4,
      },
    };
  };
  const { TutorService } =
    await import("../../../../../server/services/tutor/tutor-service");
  await new TutorService(s.provider).generateDialogResponse(
    context.code,
    [],
    context.question,
    "Die Anweisung erhöht x.",
    "key",
    undefined,
    40,
    undefined,
    undefined,
    {
      entryFile: "main.ino",
      headers: [{ name: "helper.h", content: "int helper;\nvoid helfen();" }],
    },
    undefined,
    "uml1-classic-v1",
  );
  expect(prompt).toContain('"entryFile":"main.ino"');
  expect(prompt).toContain('{"file":"helper.h","lines":["1| int helper;","2| void helfen();"]}');
  expect(prompt).toContain('{"file":"main.ino","lines":["1| void arbeiten() {","2|  x++;","3| }"]}');
});
it("reports a renderer that fails to answer as unavailable, not as a provider failure", async () => {
  const s = setup();
  const { withTutorDiagnostics, getTutorReview } = await import("../../../../../server/services/tutor/tutor-diagnostics");
  const review = await withTutorDiagnostics(
    { traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), operation: "question", credential: "key" },
    async () => {
      const result = await prepareTutorUml(context, {
        ...s,
        proposal,
        renderer: { ...s.renderer, available: async () => { throw new Error("probe failed"); } },
      });
      expect(result.graphicStatus).toBe("unavailable");
      return getTutorReview({ id: "test", templateDigest: "a".repeat(64) })!;
    },
  );
  expect(review.entries).toContainEqual(expect.objectContaining({ kind: "uml", state: "unavailable", reason: "renderer-unavailable" }));
});

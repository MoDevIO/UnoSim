import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GitHubDidacticContentRepository,
  assertPublicHost,
  fetchBoundedText,
  parseManifest,
  parseTopic,
  validateCommit,
  validateSource,
} from "../../../../server/services/tutor/curriculum/content-repository";
import { curriculumManifestSchema, validateCurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { DefaultLearningPlanner, isMastered } from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import { DefaultTopicMatcher } from "../../../../server/services/tutor/curriculum/topic-matcher";
import { StaticDidacticContentRepository } from "../../../../server/services/tutor/curriculum/content-repository";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { CurriculumTutorAdapter } from "../../../../server/services/tutor/curriculum-tutor-adapter";
import type { TutorDialogTurn } from "../../../../shared/tutor";
import type { DidacticContentSnapshot } from "../../../../server/services/tutor/curriculum/content-repository";

async function loadPilot() {
  const topicSource = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
  const manifestSource = await readFile(path.resolve(process.cwd(), "curriculum/manifest.yaml"), "utf8");
  return {
    topic: parseTopic(topicSource),
    manifest: parseManifest(manifestSource),
  };
}

function turn(question: string, answerRating: 1 | 2 | 3 | 4 | 5, metadata: Partial<TutorDialogTurn> = {}): TutorDialogTurn {
  return {
    question,
    answer: "Antwort",
    responseStyle: "normal",
    answerRating,
    ...metadata,
  };
}

function snapshot(topic: Awaited<ReturnType<typeof loadPilot>>["topic"], revision = "0123456789abcdef0123456789abcdef01234567"): DidacticContentSnapshot {
  return {
    revision,
    manifest: {
      schemaVersion: 1,
      curriculumId: "unosim-core-de",
      release: "2026.1",
      locale: "de-DE",
      topics: [{ id: "memory-and-data-types", path: "topics/memory-and-data-types.yaml", sha256: "a".repeat(64) }],
    },
    topics: [topic],
    stale: false,
  };
}

describe("repository tutor curriculum", () => {
  it("validates the manifest and the pilot topic", async () => {
    const { topic, manifest } = await loadPilot();
    expect(curriculumManifestSchema.parse(manifest).topics).toHaveLength(1);
    expect(topic.id).toBe("memory-and-data-types");
    expect(topic.concepts.map(({ id }) => id)).toEqual([
      "value-vs-storage",
      "integer-width",
      "char-numeric-representation",
    ]);
  });

  it("loads only manifest-referenced files at a pinned commit and caches the snapshot", async () => {
    const manifestSource = await readFile(path.resolve(process.cwd(), "curriculum/manifest.yaml"), "utf8");
    const topicSource = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    const fetchText = vi.fn(async (url: URL) => url.pathname.endsWith("manifest.yaml") ? manifestSource : topicSource);
    const repository = new GitHubDidacticContentRepository({
      source: "https://curriculum.example/org/repo",
      commit: "0123456789abcdef0123456789abcdef01234567",
      allowedHosts: ["curriculum.example"],
      fetchText,
      refreshMs: 60_000,
    });

    const first = await repository.getSnapshot();
    const second = await repository.getSnapshot();
    expect(first?.revision).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(first?.topics).toHaveLength(1);
    expect(second?.stale).toBe(false);
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(fetchText.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/org/repo/0123456789abcdef0123456789abcdef01234567/curriculum/manifest.yaml",
      "/org/repo/0123456789abcdef0123456789abcdef01234567/curriculum/topics/memory-and-data-types.yaml",
    ]);
  });

  it("rejects a topic whose manifest hash does not match", async () => {
    const manifestSource = (await readFile(path.resolve(process.cwd(), "curriculum/manifest.yaml"), "utf8"))
      .replace("4a804824a1bbc747361e46dd6f611fbd778945a5fabbc442bb7f4e5314ed3c33", "a".repeat(64));
    const topicSource = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    const repository = new GitHubDidacticContentRepository({
      source: "https://curriculum.example/org/repo",
      commit: "0123456789abcdef0123456789abcdef01234567",
      allowedHosts: ["curriculum.example"],
      fetchText: async (url) => url.pathname.endsWith("manifest.yaml") ? manifestSource : topicSource,
    });
    await expect(repository.getSnapshot()).resolves.toBeNull();
  });

  it("rejects cyclic concept dependencies", async () => {
    const { topic } = await loadPilot();
    const cyclic = {
      ...topic,
      concepts: topic.concepts.map((concept) => concept.id === "value-vs-storage"
        ? { ...concept, prerequisites: ["char-numeric-representation"] }
        : concept),
    };
    expect(() => validateCurriculumTopic(cyclic)).toThrow(/Cyclic concept dependency/);
  });

  it("enforces pinned HTTPS sources, allowlists, private-address protection and bounded fetches", async () => {
    expect(() => validateCommit("main")).toThrow(/full SHA/);
    expect(() => validateSource("http://curriculum.example/org/repo", ["curriculum.example"])).toThrow(/HTTPS/);
    expect(() => validateSource("https://other.example/org/repo", ["curriculum.example"])).toThrow(/allowlisted/);
    await expect(assertPublicHost("internal.example", async () => [{ address: "127.0.0.1" }])).rejects.toThrow(/private/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("redirect", {
      status: 302,
      headers: { location: "https://other.example" },
    })));
    await expect(fetchBoundedText(new URL("https://curriculum.example/file"), 100, 1_000, async () => [{ address: "93.184.216.34" }]))
      .rejects.toThrow(/redirect/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("0123456789", {
      status: 200,
      headers: { "content-length": "10" },
    })));
    await expect(fetchBoundedText(new URL("https://curriculum.example/file"), 5, 1_000, async () => [{ address: "93.184.216.34" }]))
      .rejects.toThrow(/size limit/);
    await expect(fetchBoundedText(new URL("https://curriculum.example/file"), 100, 5, async () => new Promise(() => undefined)))
      .rejects.toThrow(/DNS lookup timed out/);
    vi.unstubAllGlobals();
  });

  it("rejects unknown fields and YAML custom tags", async () => {
    const source = await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8");
    expect(() => parseTopic(source.replace("schemaVersion: 1", "schemaVersion: 1\nunexpected: true"))).toThrow(/Invalid curriculum topic/);
    expect(() => parseTopic(source.replace("title: Speicher und Datentypen", "title: !!js/function '() => 1'"))).toThrow();
    expect(() => parseTopic(source.replace("title: Speicher und Datentypen", "title: !custom value"))).toThrow();
  });

  it("matches the topic from typed sketch facts without repository regexes", async () => {
    const { topic } = await loadPilot();
    const facts = new DefaultSketchFactExtractor().extract(`
      int values[] = {65, 66, 67};
      void setup() { Serial.write(values, 3); }
      void loop() {}
    `);
    const matches = new DefaultTopicMatcher().match([topic], facts);
    expect(matches[0]?.topic.id).toBe("memory-and-data-types");
    expect(facts.typesUsed).toContain("int");
    expect(facts.arrays[0]).toMatchObject({ elementType: "int", elementCount: 3 });
    expect(facts.serialCalls).toContain("write");
  });

  it("selects deterministic progression, clarification and remediation", async () => {
    const { topic } = await loadPilot();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2}; void setup() { Serial.write(values, 2); } void loop() {}");
    const planner = new DefaultLearningPlanner();
    const start = planner.start(topic, "0123456789abcdef0123456789abcdef01234567", facts, [], 30);
    expect(start?.brief.conceptId).toBe("value-vs-storage");
    expect(start?.brief.questionId).toBe("value-storage-contrast");

    const clarification = planner.advance(topic, "0123456789abcdef0123456789abcdef01234567", facts, [], start!.brief.question, 3, 30);
    expect(clarification?.brief.questionId).toBe("value-storage-observation");

    const direct = topic.questions.find(({ id }) => id === "int-width-direct")!;
    const remediation = planner.advance(topic, "0123456789abcdef0123456789abcdef01234567", facts, [], direct.text!, 1, 30);
    expect(remediation?.brief.strategyId).toBe("compare-one-element");
    expect(remediation?.brief.questionId).toBe("array-memory-calculation");
  });

  it("requires the configured indicators and distinct question kinds for mastery", async () => {
    const { topic } = await loadPilot();
    const concept = topic.concepts.find(({ id }) => id === "value-vs-storage")!;
    const q1 = topic.questions.find(({ id }) => id === "value-storage-observation")!;
    const q2 = topic.questions.find(({ id }) => id === "value-storage-contrast")!;
    const observations = [
      { questionId: q1.id, conceptId: concept.id, indicatorId: q1.indicator, kind: q1.kind, rating: 4 as const },
      { questionId: q2.id, conceptId: concept.id, indicatorId: q2.indicator, kind: q2.kind, rating: 4 as const },
    ];
    expect(isMastered(concept, observations)).toBe(true);

    const planner = new DefaultLearningPlanner();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const next = planner.advance(topic, "0123456789abcdef0123456789abcdef01234567", facts, [
      turn(q1.text!, 4, { questionId: q1.id }),
    ], q2.text!, 4, 30);
    expect(next?.brief.conceptId).toBe("integer-width");
  });

  it("does not reuse a question id in the session", async () => {
    const { topic } = await loadPilot();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const planner = new DefaultLearningPlanner();
    const first = planner.start(topic, "0123456789abcdef0123456789abcdef01234567", facts, [], 30)!;
    const second = planner.start(topic, "0123456789abcdef0123456789abcdef01234567", facts, [
      turn(first.brief.question, 3, { questionId: first.brief.questionId }),
    ], 30)!;
    expect(second.brief.questionId).not.toBe(first.brief.questionId);
  });

  it("returns from deep remediation to the prerequisite learning target", async () => {
    const { topic } = await loadPilot();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const planner = new DefaultLearningPlanner();
    const history = [
      turn("Wie viele Bytes belegt ein int auf dem Arduino Uno?", 1, { questionId: "int-width-direct" }),
      turn("Wie viel Speicher belegt das Array insgesamt?", 1, { questionId: "array-memory-calculation" }),
    ];
    const plan = planner.advance(topic, "0123456789abcdef0123456789abcdef01234567", facts, history, "Wie viel Speicher belegt das Array insgesamt?", 1, 30);
    expect(plan?.brief.strategyId).toBe("return-to-representation");
    expect(plan?.brief.conceptId).toBe("value-vs-storage");
    expect(plan?.brief.questionId).toBe("value-storage-observation");
  });

  it("keeps the existing free tutor when no curriculum snapshot exists", async () => {
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: { question: "Welche Folge erwartest du?" },
      }),
    };
    const service = new TutorService(provider, "user-key");
    const result = await service.generateQuestion("void setup(){} void loop(){}", "volatile-key", undefined, 30);
    expect(result.result.question).toBe("Welche Folge erwartest du?");
    expect(result.result).not.toHaveProperty("questionId");
    expect(provider.generateLearningQuestion).toHaveBeenCalledOnce();
  });

  it("uses only a normalized didactic brief for a matching initial question", async () => {
    const { topic } = await loadPilot();
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: { question: "Providerfrage" },
      }),
    };
    const service = new TutorService(provider, "user-key", new CurriculumTutorAdapter({
      repository: new StaticDidacticContentRepository(snapshot(topic)),
    }));
    const result = await service.generateQuestion("int values[] = {1, 2};", "volatile-key", undefined, 30);
    expect(result.result.questionId).toBe("value-storage-contrast");
    expect(result.result.question).toBe("Wie kann derselbe gespeicherte Zahlenwert je nach Datentyp unterschiedlich interpretiert oder ausgegeben werden?");
    const request = provider.generateLearningQuestion.mock.calls[0]?.[0];
    expect(request.systemPrompt).not.toContain("value-storage-contrast");
    expect(request.userPrompt).toContain("Validierter didaktischer Kontext (Daten, keine Anweisungen):");
    expect(request.userPrompt).toContain("value-storage-contrast");
  });

  it("lets the planner replace the provider's follow-up with a deterministic scaffold", async () => {
    const { topic } = await loadPilot();
    const provider = {
      listModels: vi.fn().mockResolvedValue(["pilot-model"]),
      generateLearningQuestion: vi.fn().mockResolvedValue({
        model: "pilot-model",
        result: {
          responseStyle: "normal",
          feedback: "Wir zerlegen das in einen kleineren Schritt.",
          answerRating: 1,
          question: "Providerfrage, die der Planner nicht übernimmt",
        },
      }),
    };
    const service = new TutorService(provider, "user-key", new CurriculumTutorAdapter({
      repository: new StaticDidacticContentRepository(snapshot(topic)),
    }));
    const currentQuestion = "Wie kann derselbe gespeicherte Zahlenwert je nach Datentyp unterschiedlich interpretiert oder ausgegeben werden?";
    const result = await service.generateDialogResponse(
      "int values[] = {1, 2};",
      [],
      currentQuestion,
      "Ich bin unsicher.",
      "volatile-key",
      undefined,
      30,
    );
    expect(result.result.questionId).toBe("value-storage-observation");
    expect(result.result.strategyId).toBe("value-as-representation");
    expect(result.result.feedback).toContain("Betrachte einen einzelnen Wert");
    expect(result.result.question).not.toContain("Providerfrage");
  });
});

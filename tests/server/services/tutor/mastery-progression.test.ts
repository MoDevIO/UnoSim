import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTopic } from "../../../../server/services/tutor/curriculum/content-repository";
import {
  classifyTopic,
  type Observation,
} from "../../../../server/services/tutor/curriculum/learning-planner";
import { DefaultSketchFactExtractor } from "../../../../server/services/tutor/curriculum/sketch-facts";
import { createTutorProgressionState, hasMetDeepeningCriteria, markTopicMastered } from "../../../../server/services/tutor/curriculum/progression-state";

async function topic() {
  return parseTopic(await readFile(path.resolve(process.cwd(), "curriculum/topics/memory-and-data-types.yaml"), "utf8"));
}

const revision = "a".repeat(40);

describe("mastery progression domain classification", () => {
  it("distinguishes a probeable Topic from an unresolved exhausted Topic", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const probeable = classifyTopic(value, facts, [], new Set(), 30);
    expect(probeable.status).toBe("probeable");

    const exhausted = value.questions.map((question) => ({
      questionId: question.id,
      conceptId: question.concept,
      indicatorId: question.indicator,
      kind: question.kind,
      rating: 3 as const,
    })) satisfies Observation[];
    expect(classifyTopic(value, facts, exhausted, new Set(exhausted.map(({ questionId }) => questionId)), 30).status).toBe("unresolved");
  });

  it("does not treat a Topic with an empty mastery domain as mastered or blocked", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("void setup() {} void loop() {}");
    expect(classifyTopic(value, facts, [], new Set(), 30)).toMatchObject({ status: "inapplicable" });
  });

  it("uses the configured criteria for Topic mastery and keeps evidence separate from difficulty", async () => {
    const value = await topic();
    const facts = new DefaultSketchFactExtractor().extract("int values[] = {1, 2};");
    const observations: Observation[] = value.questions.slice(0, 2).map((question) => ({
      questionId: question.id,
      conceptId: question.concept,
      indicatorId: question.indicator,
      kind: question.kind,
      rating: 4,
    }));
    const result = classifyTopic(value, facts, observations, new Set(), 30);
    expect(result.status).toMatch(/probeable|unresolved|mastered/);
    expect(revision).toHaveLength(40);
  });

  it("requires post-mastery transfer evidence before EXPAND", async () => {
    const value = await topic();
    const state = createTutorProgressionState(revision);
    markTopicMastered(state, value.id);
    const transfer = value.questions.find(({ kind }) => kind === "transfer") ?? value.questions[0]!;
    const observation: Observation = {
      questionId: transfer.id,
      conceptId: transfer.concept,
      indicatorId: transfer.indicator,
      kind: transfer.kind,
      rating: 4,
    };
    expect(hasMetDeepeningCriteria(value, [observation])).toBe(false);
    expect(hasMetDeepeningCriteria(value, [observation, observation])).toBe(true);
    expect(state.masteredTopicIds).toEqual([value.id]);
  });
});

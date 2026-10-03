import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_COURSE_CONTENT_FIXTURE_IDS,
  createAnchorCourseContent,
} from "../../../../../server/services/tutor/evaluation/anchor-course-content";
import { classifyTopic } from "../../../../../server/services/tutor/curriculum/learning-planner";
import { hasMetDeepeningCriteria } from "../../../../../server/services/tutor/curriculum/progression-state";
import { DefaultSketchFactExtractor } from "../../../../../server/services/tutor/curriculum/sketch-facts";

// The anchor fixtures must describe progression states the product can reach (R-AUT-2): a
// mastered Topic carries the LEARN evidence that masters it, and a post-mastery phase carries the
// post-mastery evidence that leads into it. Otherwise DEEPEN/EXPAND cases measure follow-ups that
// no real session produces, such as the LEARN question coming back as a post-mastery question.

const SKETCHES = ["evals/tutor-quality/fixtures/simple-variable.ino", "evals/tutor-quality/fixtures/serial-output.ino"];

describe("anchor Course Content fixtures describe reachable progression states", () => {
  for (const fixtureId of ANCHOR_COURSE_CONTENT_FIXTURE_IDS) {
    it(`${fixtureId}: every mastered Topic is mastered by its own evidence, and the phase follows from it`, () => {
      const content = createAnchorCourseContent(fixtureId);
      const state = content.progressionState!;
      const topics = content.tutor?.status === "valid" ? content.tutor.topics : [];

      for (const topicId of state.masteredTopicIds) {
        const topic = topics.find(({ id }) => id === topicId)!;
        const evidence = state.masteryEvidence[topicId] ?? [];
        const postMastery = state.postMasteryEvidence[topicId] ?? [];
        const questionIds = new Set(topic.questions.map(({ id }) => id));
        expect([...evidence, ...postMastery].map(({ questionId }) => questionId).filter((id) => !questionIds.has(id))).toEqual([]);
        for (const sketch of SKETCHES) {
          const facts = new DefaultSketchFactExtractor().extract(readFileSync(sketch, "utf8"));
          const usedQuestionIds = new Set(evidence.map(({ questionId }) => questionId));
          expect(classifyTopic(topic, facts, evidence, usedQuestionIds, 30).status).toBe("mastered");
        }
        const phase = state.retainedPhases[topicId] ?? "DEEPEN";
        expect(phase).toBe(state.phase);
        expect(hasMetDeepeningCriteria(topic, postMastery)).toBe(phase === "EXPAND");
      }
    });
  }
});

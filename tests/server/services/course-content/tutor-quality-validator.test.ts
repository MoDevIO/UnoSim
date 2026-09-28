import { describe, expect, it } from "vitest";
import type { CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import {
  validateTutorContentQuality,
  type ResolvedTutorQualityCase,
} from "../../../../server/services/course-content/tutor-quality-validator";

const serialSketch = "int value = 3; void setup() { Serial.println(value); } void loop() {}";
const pwmSketch = "const int pin = 9; void setup() {} void loop() { analogWrite(pin, 128); }";

function validTopic(): CurriculumTopic {
  return {
    schemaVersion: 1,
    id: "variables-and-serial",
    title: "Variablen",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "values",
      title: "Werte",
      objective: "Werte und Ausgabe verbinden",
      prerequisites: [],
      difficulty: { entry: [1, 50], transfer: [20, 80] },
      misconceptions: [],
      indicators: [{ id: "value-use", description: "Verwendung erklären" }],
      mastery: {
        minimumSuccessfulProbes: 1,
        successRatingAtLeast: 3,
        requiredIndicators: ["value-use"],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    }],
    questions: [
      question("learn-concept", "concept"),
      question("deepen-transfer", "transfer"),
      question("deepen-prediction", "prediction"),
    ],
    scaffolds: [],
    progression: {
      entryConcepts: ["values"],
      preferredOrder: ["values"],
      onRating: {
        "1-2": "remediate",
        "3": "clarify-same-indicator",
        "4": "probe-missing-indicator",
        "5": "evaluate-mastery-and-advance",
      },
    },
  };
}

function question(id: string, kind: "recall" | "concept" | "application" | "prediction" | "transfer") {
  return {
    id,
    concept: "values",
    indicator: "value-use",
    kind,
    difficulty: [1, 80] as [number, number],
    requires: [{ fact: "serial-call" as const, values: ["print"] }],
    text: `Frage ${id}?`,
  };
}

function cases(): ResolvedTutorQualityCase[] {
  return [
    {
      id: "serial-positive",
      exampleId: "serial",
      code: serialSketch,
      expectedTopics: ["variables-and-serial"],
      forbiddenTopics: [],
    },
    {
      id: "pwm-negative",
      exampleId: "pwm",
      code: pwmSketch,
      expectedTopics: [],
      forbiddenTopics: ["variables-and-serial"],
    },
  ];
}

function codes(issues: ReturnType<typeof validateTutorContentQuality>) {
  return issues.map(({ code }) => code);
}

describe("deterministic Tutor Course Content quality", () => {
  it("accepts covered activation and an executable mastery-to-DEEPEN path", () => {
    expect(validateTutorContentQuality([validTopic()], cases())).toEqual([]);
  });

  it("reports positive and negative activation mismatches and missing Topic coverage", () => {
    const topic = validTopic();
    const activationCases: ResolvedTutorQualityCase[] = [{
      id: "wrong-cases",
      exampleId: "pwm",
      code: pwmSketch,
      expectedTopics: [topic.id],
      forbiddenTopics: [],
    }];

    expect(codes(validateTutorContentQuality([topic], activationCases))).toEqual(expect.arrayContaining([
      "expected-topic-not-activated",
      "missing-negative-activation-case",
    ]));
  });

  it("reports quality cases that reference an unknown Topic", () => {
    const unknownTopicCase: ResolvedTutorQualityCase = {
      ...cases()[0]!,
      expectedTopics: ["missing-topic"],
    };

    expect(codes(validateTutorContentQuality([validTopic()], [unknownTopicCase]))).toContain("unknown-topic-reference");
  });

  it("reports Concepts and required Indicators with no applicable question", () => {
    const topic = validTopic();
    topic.concepts.push({
      ...topic.concepts[0]!,
      id: "unreachable",
      title: "Unerreichbar",
      indicators: [{ id: "missing-indicator", description: "Nicht prüfbar" }],
      mastery: { ...topic.concepts[0]!.mastery, requiredIndicators: ["missing-indicator"] },
    });
    topic.progression.preferredOrder.push("unreachable");

    expect(codes(validateTutorContentQuality([topic], cases()))).toEqual(expect.arrayContaining([
      "unreachable-concept",
      "unreachable-indicator",
    ]));
  });

  it("reports mastery probe and distinct-kind shortages", () => {
    const topic = validTopic();
    topic.concepts[0]!.mastery.minimumSuccessfulProbes = 4;
    topic.concepts[0]!.mastery.minimumDistinctQuestionKinds = 4;

    expect(codes(validateTutorContentQuality([topic], cases()))).toEqual(expect.arrayContaining([
      "insufficient-mastery-probes",
      "insufficient-mastery-question-kinds",
      "learn-content-exhausted",
    ]));
  });

  it("reports an applicable Concept whose prerequisite cannot be probed", () => {
    const topic = validTopic();
    topic.concepts.unshift({
      ...topic.concepts[0]!,
      id: "prerequisite",
      title: "Vorwissen",
      indicators: [{ id: "prerequisite-indicator", description: "Vorwissen" }],
      mastery: { ...topic.concepts[0]!.mastery, requiredIndicators: ["prerequisite-indicator"] },
    });
    topic.concepts[1]!.prerequisites = ["prerequisite"];
    topic.progression.entryConcepts = ["prerequisite"];
    topic.progression.preferredOrder = ["prerequisite", "values"];

    expect(codes(validateTutorContentQuality([topic], cases()))).toContain("unreachable-prerequisite");
  });

  it("reports a missing required DEEPEN kind and obvious post-mastery exhaustion", () => {
    const topic = validTopic();
    topic.questions = [question("only-learn", "concept")];

    expect(codes(validateTutorContentQuality([topic], cases()))).toEqual(expect.arrayContaining([
      "missing-deepening-question-kind",
      "deepen-content-exhausted",
    ]));
  });
});

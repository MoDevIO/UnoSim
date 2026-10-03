import { describe, expect, it } from "vitest";
import type { CurriculumTopic } from "../../../../server/services/tutor/curriculum/curriculum-schema";
import { BUILT_IN_TUTOR_STRATEGY } from "../../../../server/services/tutor/strategy/effective-tutor-strategy";
import {
  validateExampleTopicActivations,
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

// Authoring invariant over the whole Example catalog, independent of quality cases: every Topic
// that the production matcher activates on an Example must let a learner who answers every
// planned question successfully reach Topic mastery. A Topic that is unresolved from the first
// turn blocks the Topic-driven Tutor for the whole session (LearningQuestions SSOT 2.3).
describe("Example catalog Topic activations", () => {
  const serialOnlySketch = 'void setup() { Serial.begin(9600); Serial.println("Hallo"); } void loop() {}';

  // Concept "output" needs only Serial; its prerequisite "values" is probeable only with an int.
  function prerequisiteTopic(withPrerequisite: boolean): CurriculumTopic {
    const topic = validTopic();
    const values = topic.concepts[0]!;
    topic.concepts = [
      { ...values, id: "values", prerequisites: [] },
      {
        ...values,
        id: "output",
        title: "Ausgabe",
        indicators: [{ id: "output-use", description: "Ausgabe erklären" }],
        mastery: { ...values.mastery, requiredIndicators: ["output-use"] },
        prerequisites: withPrerequisite ? ["values"] : [],
      },
    ];
    topic.questions = [
      { ...question("values-recall", "recall"), requires: [{ fact: "type-used" as const, values: ["int"] }] },
      { ...question("output-concept", "concept"), concept: "output", indicator: "output-use" },
      { ...question("output-transfer", "transfer"), concept: "output", indicator: "output-use" },
    ];
    topic.progression.entryConcepts = ["values"];
    topic.progression.preferredOrder = ["values", "output"];
    return topic;
  }

  it("reports an Example that activates a Topic no learner can master, without any quality case", () => {
    const issues = validateExampleTopicActivations([prerequisiteTopic(true)], [{ id: "serial-only", code: serialOnlySketch }]);

    expect(issues).toEqual([expect.objectContaining({
      code: "unmasterable-example-activation",
      exampleId: "serial-only",
      topicId: "variables-and-serial",
    })]);
  });

  it("accepts the same Topic once the Concept no longer requires an unprobeable prerequisite", () => {
    expect(validateExampleTopicActivations([prerequisiteTopic(false)], [{ id: "serial-only", code: serialOnlySketch }])).toEqual([]);
  });

  it("accepts the prerequisite where the sketch makes it probeable", () => {
    expect(validateExampleTopicActivations([prerequisiteTopic(true)], [{ id: "int-serial", code: serialSketch }])).toEqual([]);
  });

  it("ignores Examples on which the Topic is not activated", () => {
    expect(validateExampleTopicActivations([prerequisiteTopic(true)], [{ id: "pwm", code: pwmSketch }])).toEqual([]);
  });

  it("does not forbid later, learner-dependent exhaustion when a successful learner reaches mastery", () => {
    // One question per Concept: weak answers would exhaust the Topic later, but mastery is reachable.
    const topic = prerequisiteTopic(false);
    topic.questions = topic.questions.filter(({ id }) => id !== "output-transfer");

    expect(validateExampleTopicActivations([topic], [{ id: "serial-only", code: serialOnlySketch }])).toEqual([]);
  });

  it("uses the Example's effective LEARN strategy for the path", () => {
    const relaxed = { ...BUILT_IN_TUTOR_STRATEGY, id: "relaxed-policy", repetition: "relaxed" as const };
    const issues = validateExampleTopicActivations([prerequisiteTopic(true)], [{ id: "serial-only", code: serialOnlySketch, learnStrategy: relaxed }]);

    expect(codes(issues)).toEqual(["unmasterable-example-activation"]);
  });
});

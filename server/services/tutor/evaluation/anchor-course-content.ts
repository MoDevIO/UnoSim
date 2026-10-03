import type { TutorCapability } from "../../course-content/course-content-loader";
import { curriculumTopicSchema, validateCurriculumTopic, type CurriculumTopic } from "../curriculum/curriculum-schema";
import { createTutorProgressionState, type TutorProgressionState } from "../curriculum/progression-state";
import type { TutorPlanningContentContext } from "../tutor-planning";

export const ANCHOR_COURSE_CONTENT_FIXTURE_IDS = [
  "variables",
  "progression-learn",
  "progression-deepen",
  "progression-expand",
] as const;

export type AnchorCourseContentFixtureId = typeof ANCHOR_COURSE_CONTENT_FIXTURE_IDS[number];

const REVISION = "2".repeat(40);

function variableTopic(schemaVersion: 1 | 2 = 1): CurriculumTopic {
  const raw = {
    schemaVersion,
    id: "variables-and-serial",
    title: "Variablen und Serial-Ausgabe",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print"] }] },
    concepts: [{
      id: "variable-values",
      title: "Variablenwerte",
      objective: "Den Zusammenhang zwischen einem deklarierten Integerwert und seiner Verwendung erklären.",
      prerequisites: [],
      difficulty: { entry: [1, 50], transfer: [20, 80] },
      misconceptions: [],
      indicators: [{ id: "relates-value-to-use", description: "Ordnet einen Integerwert seiner Verwendung im Sketch zu." }],
      mastery: {
        minimumSuccessfulProbes: 1,
        successRatingAtLeast: 3,
        requiredIndicators: ["relates-value-to-use"],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    }],
    questions: [
      {
        id: "variable-value-recall",
        concept: "variable-values",
        indicator: "relates-value-to-use",
        kind: "recall",
        difficulty: [1, 50],
        requires: [{ fact: "type-used", values: ["int"] }],
        text: "Welche Rolle spielt der Integer-Datentyp im aktuellen Sketch?",
      },
      {
        id: "serial-output-prediction",
        concept: "variable-values",
        indicator: "relates-value-to-use",
        kind: "prediction",
        difficulty: [20, 70],
        requires: [{ fact: "serial-call", values: ["print"] }],
        text: "Welche Ausgabe erzeugt Serial.println im aktuellen Sketch?",
      },
      {
        id: "variable-output-transfer",
        concept: "variable-values",
        indicator: "relates-value-to-use",
        kind: "transfer",
        difficulty: [30, 90],
        requires: [{ fact: "type-used", values: ["int"] }, { fact: "serial-call", values: ["print"] }],
        text: "Wie würdest du die Veränderung von counter an der seriellen Ausgabe überprüfen?",
      },
      // Post-mastery content of the DEEPEN/EXPAND fixtures. Its premise (a stored int value that is
      // printed via Serial) holds on both anchor sketches.
      ...(schemaVersion === 2 ? [{
        id: "variable-output-application",
        concept: "variable-values",
        indicator: "relates-value-to-use",
        kind: "application",
        difficulty: [20, 90],
        requires: [{ fact: "type-used", values: ["int"] }, { fact: "serial-call", values: ["print"] }],
        text: "Wie hängt der gespeicherte Wert von counter mit der seriellen Ausgabe im aktuellen Sketch zusammen?",
      }] : []),
    ],
    scaffolds: [],
    progression: {
      entryConcepts: ["variable-values"],
      preferredOrder: ["variable-values"],
      onRating: {
        "1-2": "remediate",
        "3": "clarify-same-indicator",
        "4": "probe-missing-indicator",
        "5": "evaluate-mastery-and-advance",
      },
    },
    ...(schemaVersion === 2 ? {
      deepening: {
        minimumSuccessfulProbes: 1,
        successRatingAtLeast: 4,
        requiredQuestionKinds: ["transfer"],
        recentWeakAnswersAllowed: 0,
      },
      extensions: [{ topic: "serial-output", objective: "Eine weitere serielle Beobachtung am Sketch ableiten." }],
    } : {}),
  };
  return validateCurriculumTopic(curriculumTopicSchema.parse(raw));
}

function serialOutputTopic(): CurriculumTopic {
  return validateCurriculumTopic(curriculumTopicSchema.parse({
    schemaVersion: 1,
    id: "serial-output",
    title: "Serielle Ausgabe",
    locale: "de-DE",
    activation: { any: [{ fact: "type-used", values: ["float"] }] },
    concepts: [{
      id: "serial-observation",
      title: "Serielle Beobachtung",
      objective: "Eine serielle Ausgabe als Beobachtung beschreiben.",
      prerequisites: [],
      difficulty: { entry: [1, 60], transfer: [20, 80] },
      misconceptions: [],
      indicators: [{ id: "observes-output", description: "Beschreibt eine serielle Ausgabe." }],
      mastery: {
        minimumSuccessfulProbes: 1,
        successRatingAtLeast: 3,
        requiredIndicators: ["observes-output"],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    }],
    questions: [{
      id: "serial-output-observe",
      concept: "serial-observation",
      indicator: "observes-output",
      kind: "prediction",
      difficulty: [1, 60],
      requires: [{ fact: "type-used", values: ["float"] }],
      text: "Welche serielle Beobachtung erwartest du?",
    }],
    scaffolds: [],
    progression: {
      entryConcepts: ["serial-observation"],
      preferredOrder: ["serial-observation"],
      onRating: {
        "1-2": "remediate",
        "3": "clarify-same-indicator",
        "4": "probe-missing-indicator",
        "5": "evaluate-mastery-and-advance",
      },
    },
  }));
}

function tutorCapability(topics: readonly CurriculumTopic[]): TutorCapability {
  return {
    status: "valid",
    manifest: {
      schemaVersion: 2,
      topics: [],
      strategies: [],
    },
    topics,
    strategies: [],
  };
}

function baseState(): TutorProgressionState {
  return createTutorProgressionState(REVISION);
}

// A state the product can reach: the Topic is mastered through the LEARN answer that
// strategy-learn-strong-answer gives (one successful prediction probe), and EXPAND is reached
// through the DEEPEN transfer probe that the schema-v2 deepening criterion requires.
const LEARN_MASTERY_EVIDENCE = {
  questionId: "serial-output-prediction",
  conceptId: "variable-values",
  indicatorId: "relates-value-to-use",
  kind: "prediction",
  rating: 4,
} as const;

const DEEPEN_TRANSFER_EVIDENCE = {
  questionId: "variable-output-transfer",
  conceptId: "variable-values",
  indicatorId: "relates-value-to-use",
  kind: "transfer",
  rating: 4,
} as const;

function variablesCourseContent(): TutorPlanningContentContext {
  return {
    revision: REVISION,
    tutor: tutorCapability([variableTopic()]),
    progressionState: baseState(),
  };
}

export function createAnchorCourseContent(fixtureId: AnchorCourseContentFixtureId): TutorPlanningContentContext {
  switch (fixtureId) {
    case "variables":
    case "progression-learn":
      return variablesCourseContent();
    case "progression-deepen": {
      const state = baseState();
      state.activeTopicId = "variables-and-serial";
      state.phase = "DEEPEN";
      state.masteredTopicIds = ["variables-and-serial"];
      state.masteryEvidence = { "variables-and-serial": [{ ...LEARN_MASTERY_EVIDENCE }] };
      state.retainedPhases = { "variables-and-serial": "DEEPEN" };
      return {
        revision: REVISION,
        tutor: tutorCapability([variableTopic(2)]),
        progressionState: state,
      };
    }
    case "progression-expand": {
      const state = baseState();
      state.activeTopicId = "variables-and-serial";
      state.phase = "EXPAND";
      state.masteredTopicIds = ["variables-and-serial"];
      state.masteryEvidence = { "variables-and-serial": [{ ...LEARN_MASTERY_EVIDENCE }] };
      state.postMasteryEvidence = { "variables-and-serial": [{ ...DEEPEN_TRANSFER_EVIDENCE }] };
      state.retainedPhases = { "variables-and-serial": "EXPAND" };
      return {
        revision: REVISION,
        tutor: tutorCapability([variableTopic(2), serialOutputTopic()]),
        progressionState: state,
      };
    }
  }
}

import type { ExampleFocusArea } from "../../course-content/embedded-tutor-annotation";
import { validateCurriculumTopic, type CurriculumTopic } from "./curriculum-schema";

export const INLINE_FOCUS_TOPIC_PREFIX = "inline-";

/**
 * Builds the Topic for the focus areas a teacher wrote into an Example's annotation. Every focus area
 * is one Concept with its questions; a focus area is mastered once every one of its questions was
 * answered successfully, and progression uses fixed defaults. The questions carry
 * no fact requirements: the teacher authored them for exactly this sketch.
 */
export function buildInlineFocusTopic(exampleId: string, focus: readonly ExampleFocusArea[]): CurriculumTopic {
  const topic: CurriculumTopic = {
    schemaVersion: 1,
    id: `${INLINE_FOCUS_TOPIC_PREFIX}${toSafeId(exampleId)}`,
    title: "Fokus dieses Beispiels",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print", "write"] }] },
    concepts: focus.map((area) => ({
      id: area.id,
      title: area.title,
      objective: area.objective,
      prerequisites: [],
      difficulty: { entry: [1, 100], transfer: [1, 100] },
      misconceptions: [],
      indicators: [{ id: `understands-${area.id}`.slice(0, 64), description: area.objective }],
      mastery: {
        minimumSuccessfulProbes: area.questions.length,
        successRatingAtLeast: 3,
        requiredIndicators: [`understands-${area.id}`.slice(0, 64)],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    })),
    questions: focus.flatMap((area) => area.questions.map((question, index) => ({
      id: `${area.id}-q${index + 1}`.slice(0, 64),
      concept: area.id,
      indicator: `understands-${area.id}`.slice(0, 64),
      kind: question.kind,
      difficulty: [1, 100] as [number, number],
      requires: [],
      text: question.text,
    }))),
    scaffolds: [],
    progression: {
      entryConcepts: [focus[0]?.id ?? ""],
      preferredOrder: focus.map(({ id }) => id),
      onRating: {
        "1-2": "remediate",
        "3": "clarify-same-indicator",
        "4": "probe-missing-indicator",
        "5": "evaluate-mastery-and-advance",
      },
    },
  };
  return validateCurriculumTopic(topic);
}

function toSafeId(value: string): string {
  const parts: string[] = [];
  let current = "";
  for (const character of value.toLowerCase()) {
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-") {
      current += character;
    } else if (current !== "") {
      parts.push(current);
      current = "";
    }
  }
  if (current !== "") parts.push(current);
  const cleaned = parts.join("-").replaceAll("--", "-");
  return (cleaned === "" ? "example" : cleaned).slice(0, 64 - INLINE_FOCUS_TOPIC_PREFIX.length);
}

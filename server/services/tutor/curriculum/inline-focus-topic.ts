import type { ExampleFocusArea } from "../../course-content/embedded-tutor-annotation";
import { focusQuestionFilter } from "./focus-applicability";
import { validateCurriculumTopic, type CurriculumTopic } from "./curriculum-schema";

export const INLINE_FOCUS_TOPIC_PREFIX = "inline-";

/**
 * Builds the Topic for the focus areas a teacher wrote into an Example's annotation. Every focus area
 * is one Concept with its questions; a focus area is mastered once every one of its questions was
 * answered successfully, and progression uses fixed defaults. With `code`, only the questions that
 * still fit the current sketch stay in the Topic, under the IDs they have in the whole focus; a sketch
 * none of them fits has no focus Topic.
 */
export function buildInlineFocusTopic(exampleId: string, focus: readonly ExampleFocusArea[], code?: string): CurriculumTopic | null {
  const applies = code === undefined ? () => true : focusQuestionFilter(focus, code);
  const areas = focus
    .map((area) => ({ area, questions: area.questions.map((question, index) => ({ question, index })).filter(({ question }) => applies(question.text)) }))
    .filter(({ questions }) => questions.length > 0);
  if (areas.length === 0) return null;
  const topic: CurriculumTopic = {
    schemaVersion: 1,
    id: `${INLINE_FOCUS_TOPIC_PREFIX}${toSafeId(exampleId)}`,
    title: "Fokus dieses Beispiels",
    locale: "de-DE",
    activation: { any: [{ fact: "serial-call", values: ["print", "write"] }] },
    concepts: areas.map(({ area, questions }) => ({
      id: area.id,
      title: area.title,
      objective: area.objective,
      prerequisites: [],
      difficulty: { entry: [1, 100], transfer: [1, 100] },
      misconceptions: [],
      indicators: [{ id: `understands-${area.id}`.slice(0, 64), description: area.objective }],
      mastery: {
        minimumSuccessfulProbes: questions.length,
        successRatingAtLeast: 3,
        requiredIndicators: [`understands-${area.id}`.slice(0, 64)],
        minimumDistinctQuestionKinds: 1,
        recentWeakAnswersAllowed: 0,
      },
    })),
    questions: areas.flatMap(({ area, questions }) => questions.map(({ question, index }) => ({
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
      entryConcepts: [areas[0]?.area.id ?? ""],
      preferredOrder: areas.map(({ area }) => area.id),
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

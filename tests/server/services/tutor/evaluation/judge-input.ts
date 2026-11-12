import { judgeEvidence, type TutorQualityJudgeInput } from "../../../../../server/services/tutor/evaluation/judge";

/**
 * The Judge input of a transcript, or undefined when no Judge call happens. Production reads the reason from
 * `judgeEvidence` directly; the tests that only ask "is there an input, and which" use this short form.
 */
export function buildJudgeInput(
  scenario: Parameters<typeof judgeEvidence>[0],
  transcript: Parameters<typeof judgeEvidence>[1],
): TutorQualityJudgeInput | undefined {
  const evidence = judgeEvidence(scenario, transcript);
  return evidence.status === "ready" ? evidence.input : undefined;
}

import { z } from "zod";

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

const tutorQualityCaseSchema = z.object({
  id: z.string().regex(SAFE_ID),
  example: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  expectedTopics: z.array(z.string().regex(SAFE_ID)).max(64).default([]),
  forbiddenTopics: z.array(z.string().regex(SAFE_ID)).max(64).default([]),
}).strict().superRefine((value, context) => {
  if (value.expectedTopics.length === 0 && value.forbiddenTopics.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A quality case must declare an expected or forbidden Topic" });
  }
  const overlap = value.expectedTopics.find((topicId) => value.forbiddenTopics.includes(topicId));
  if (overlap) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Topic cannot be expected and forbidden: ${overlap}` });
  }
});

export const tutorQualityCasesSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(tutorQualityCaseSchema).min(1).max(256),
}).strict().superRefine((value, context) => {
  if (new Set(value.cases.map(({ id }) => id)).size !== value.cases.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cases"], message: "Quality case ids must be unique" });
  }
});

export type TutorQualityCases = z.infer<typeof tutorQualityCasesSchema>;

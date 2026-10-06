import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const EMBEDDED_TUTOR_ANNOTATION_MAX_BYTES = 16 * 1024;
const OPENING_MARKER = "/* @unosim-tutor";
const CLOSING_MARKER = "@end-unosim-tutor */";
const SAFE_TUTOR_ID = /^[a-z][a-z0-9-]{0,63}$/;
const CONTROL_CHARACTER = /\p{Cc}/u;

const learningObjectiveSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim() : value,
  z.string().min(1).superRefine((value, context) => {
    if ([...value].length > 500) {
      context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 500, type: "string", inclusive: true, message: "Objective is too long" });
    }
    if (CONTROL_CHARACTER.test(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Objective contains a control character" });
    }
  }),
);

const SAFE_TEXT = (max: number) => z.string().trim().min(1)
  .refine((value) => [...value].length <= max, `Text is longer than ${max} characters`)
  .refine((value) => !CONTROL_CHARACTER.test(value), "Text contains a control character")
  .refine((value) => !/https?:\/\//i.test(value), "URLs are not allowed in Tutor annotations");

const focusQuestionSchema = z.object({
  kind: z.enum(["recall", "concept", "application", "prediction", "transfer"]),
  text: SAFE_TEXT(500),
}).strict();

/** A teacher-authored focus area: a few questions the Tutor prefers to ask for this Example. */
const focusAreaSchema = z.object({
  id: z.string().regex(SAFE_TUTOR_ID),
  title: SAFE_TEXT(160),
  objective: SAFE_TEXT(500),
  questions: z.array(focusQuestionSchema).min(1).max(6),
}).strict();

export type ExampleFocusArea = z.infer<typeof focusAreaSchema>;

export const embeddedTutorAnnotationSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  focus: z.array(focusAreaSchema).min(1).max(8).optional(),
  afterFocus: z.enum(["free", "topics"]).optional(),
  topics: z.array(z.string().regex(SAFE_TUTOR_ID)).min(1).max(32).optional(),
  primaryTopic: z.string().regex(SAFE_TUTOR_ID).optional(),
  strategy: z.string().regex(SAFE_TUTOR_ID).optional(),
  learningObjectives: z.array(learningObjectiveSchema).min(1).max(10).optional(),
}).strict().superRefine((value, context) => {
  if (value.schemaVersion === 1 && (value.focus !== undefined || value.afterFocus !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["focus"], message: "focus and afterFocus require schemaVersion 2" });
  }
  if (value.afterFocus !== undefined && value.focus === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["afterFocus"], message: "afterFocus requires focus" });
  }
  if (value.focus !== undefined && new Set(value.focus.map(({ id }) => id)).size !== value.focus.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["focus"], message: "focus ids must be unique" });
  }
  if (value.primaryTopic !== undefined && value.topics === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryTopic"], message: "primaryTopic requires topics" });
  }
  if (value.primaryTopic !== undefined && value.topics !== undefined && !value.topics.includes(value.primaryTopic)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["primaryTopic"], message: "primaryTopic must be listed in topics" });
  }
  if (value.topics !== undefined && new Set(value.topics).size !== value.topics.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["topics"], message: "topics must be unique" });
  }
});

export type ExampleTutorAnnotation = z.infer<typeof embeddedTutorAnnotationSchema>;

export type EmbeddedTutorAnnotationResult =
  | { readonly status: "absent"; readonly cleanedSource: string }
  | { readonly status: "valid"; readonly cleanedSource: string; readonly annotation: ExampleTutorAnnotation }
  | { readonly status: "invalid"; readonly cleanedSource: string; readonly reason: string };

type AnnotationBoundary = {
  readonly opening: number;
  readonly payloadStart: number;
  readonly closing: number;
  readonly closingEnd: number;
};

type AnnotationBoundaryResult =
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly cleanedSource: string; readonly reason: string }
  | { readonly status: "found"; readonly boundary: AnnotationBoundary };

export function extractEmbeddedTutorAnnotation(
  source: string,
  fileName: string,
  options?: { readonly isMainFile: boolean },
): EmbeddedTutorAnnotationResult {
  const boundary = findAnnotationBoundary(source, fileName, options?.isMainFile ?? fileName.toLowerCase().endsWith(".ino"));
  if (boundary.status === "absent") return { status: "absent", cleanedSource: source };
  if (boundary.status === "invalid") return boundary;

  if (Buffer.byteLength(source.slice(boundary.boundary.opening, boundary.boundary.closingEnd), "utf8") > EMBEDDED_TUTOR_ANNOTATION_MAX_BYTES) {
    return invalidResult("Tutor annotation exceeds the byte limit", cleanFrom(source, boundary.boundary.opening));
  }

  let parsed: unknown;
  try {
    const payload = source.slice(boundary.boundary.payloadStart, boundary.boundary.closing);
    if (containsYamlTag(payload)) throw new Error("YAML tags are not allowed");
    parsed = parseYaml(payload, { schema: "core", uniqueKeys: true });
  } catch {
    return invalidResult("Tutor annotation YAML is invalid", cleanFrom(source, boundary.boundary.opening));
  }

  const annotation = embeddedTutorAnnotationSchema.safeParse(parsed);
  if (!annotation.success) {
    return invalidResult("Tutor annotation schema is invalid", cleanFrom(source, boundary.boundary.opening));
  }

  return {
    status: "valid",
    cleanedSource: cleanTerminalSource(source.slice(0, boundary.boundary.opening)),
    annotation: annotation.data,
  };
}

function findAnnotationBoundary(source: string, fileName: string, isMainFile: boolean): AnnotationBoundaryResult {
  const firstOpening = source.indexOf(OPENING_MARKER);
  const firstClosing = source.indexOf(CLOSING_MARKER);
  if (firstOpening < 0 && firstClosing < 0) return { status: "absent" };
  if (firstOpening < 0) return invalidBoundary("Malformed Tutor annotation marker", "");

  if (countOccurrences(source, OPENING_MARKER) !== 1) {
    return invalidBoundary("Tutor annotation is duplicated", cleanFrom(source, firstOpening));
  }
  if (!isMainFile || !fileName.toLowerCase().endsWith(".ino")) {
    return invalidBoundary("Tutor annotation is not in the declared main .ino file", cleanFrom(source, firstOpening));
  }

  const openingLineStart = source.lastIndexOf("\n", firstOpening - 1) + 1;
  if (source.slice(openingLineStart, firstOpening).trim() !== "") {
    return invalidBoundary("Tutor annotation must start on its own line", cleanFrom(source, firstOpening));
  }

  const afterOpening = firstOpening + OPENING_MARKER.length;
  const lineBreakLength = getLineBreakLength(source, afterOpening);
  if (lineBreakLength === 0) {
    return invalidBoundary("Tutor annotation opening marker is malformed", cleanFrom(source, firstOpening));
  }

  const payloadStart = afterOpening + lineBreakLength;
  const closing = source.indexOf(CLOSING_MARKER, payloadStart);
  if (closing < 0) return invalidBoundary("Tutor annotation is unterminated", cleanFrom(source, firstOpening));

  const closingLineStart = source.lastIndexOf("\n", closing - 1) + 1;
  const closingEnd = closing + CLOSING_MARKER.length;
  const trailing = source.slice(closingEnd);
  const closingIsOnOwnLine = source.slice(closingLineStart, closing).trim() === "";
  if (!closingIsOnOwnLine || /\S/u.test(trailing)) {
    return invalidBoundary("Tutor annotation is not terminal", cleanWithoutBlock(source, firstOpening, closingEnd));
  }

  return { status: "found", boundary: { opening: firstOpening, payloadStart, closing, closingEnd } };
}

function invalidBoundary(reason: string, cleanedSource: string): AnnotationBoundaryResult {
  return { status: "invalid", reason, cleanedSource: cleanTerminalSource(cleanedSource) };
}

function getLineBreakLength(source: string, offset: number): number {
  if (source.startsWith("\r\n", offset)) return 2;
  if (source[offset] === "\n") return 1;
  return 0;
}

function invalidResult(reason: string, cleanedSource: string): EmbeddedTutorAnnotationResult {
  return { status: "invalid", reason, cleanedSource: cleanTerminalSource(cleanedSource) };
}

function cleanFrom(source: string, start: number): string {
  return source.slice(0, start);
}

function cleanWithoutBlock(source: string, start: number, end: number): string {
  return `${source.slice(0, start)}${source.slice(end)}`;
}

function cleanTerminalSource(source: string): string {
  if (source.length === 0 || source.endsWith("\n")) return source;
  return `${source}\n`;
}

function countOccurrences(source: string, marker: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(marker, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + marker.length;
  }
}

function containsYamlTag(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "!") continue;
    const previous = source[index - 1];
    if (previous !== undefined && !/\s|,|:|\{|\}|\[|\]/u.test(previous)) continue;
    const next = source[index + 1];
    if (next === "!" || next === "<" || (next !== undefined && /[A-Za-z]/u.test(next))) return true;
  }
  return false;
}

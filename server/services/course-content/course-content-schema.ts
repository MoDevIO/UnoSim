import { z } from "zod";
import {
  examplesManifestSchema,
  manifestExampleSchema,
  validateManifestReferences,
  type ExamplesManifestCore,
} from "../examples/examples-schema";

const SAFE_ID = /^[a-z][a-z0-9-]{0,63}$/;

export const tutorDescriptorSchema = z.object({
  manifest: z.literal("tutor/manifest.yaml"),
}).strict();

export const exampleTutorBindingSchema = z.object({
  topics: z.array(z.string().regex(SAFE_ID)).min(1).max(32).optional(),
  primaryTopic: z.string().regex(SAFE_ID).optional(),
  strategy: z.string().regex(SAFE_ID).optional(),
}).strict().superRefine((value, context) => {
  if (value.primaryTopic !== undefined && value.topics !== undefined && !value.topics.includes(value.primaryTopic)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "primaryTopic must be listed in topics" });
  }
});

const v2ExampleSchema = manifestExampleSchema.extend({
  tutor: exampleTutorBindingSchema.optional(),
}).strict();

const v2ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  repository: z.string().max(256).optional(),
  ref: z.string().max(128).optional(),
  examples: z.array(v2ExampleSchema).max(1000),
  tutor: tutorDescriptorSchema.optional(),
}).strict();

export const courseContentManifestSchema = z.union([examplesManifestSchema, v2ManifestSchema]);

export type CourseContentManifest = z.infer<typeof courseContentManifestSchema>;
export type ExampleTutorBinding = z.infer<typeof exampleTutorBindingSchema>;
export type TutorDescriptor = z.infer<typeof tutorDescriptorSchema>;

export const courseContentTopicEntrySchema = z.object({
  id: z.string().regex(SAFE_ID),
  path: z.string().regex(/^tutor\/topics\/[a-z][a-z0-9-]{0,63}\.yaml$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export const courseContentStrategyEntrySchema = z.object({
  id: z.string().regex(SAFE_ID),
  path: z.string().regex(/^tutor\/strategies\/[a-z][a-z0-9-]{0,63}\.yaml$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

export const courseContentTutorManifestSchema = z.object({
  schemaVersion: z.literal(1),
  defaultStrategy: z.string().regex(SAFE_ID).optional(),
  topics: z.array(courseContentTopicEntrySchema).max(64),
  strategies: z.array(courseContentStrategyEntrySchema).max(64),
}).strict();

export type CourseContentTutorManifest = z.infer<typeof courseContentTutorManifestSchema>;

type InvalidCapability = { readonly status: "invalid"; readonly reason: string };

export type CourseContentValidation = {
  readonly examples:
    | { readonly status: "valid"; readonly manifest: ExamplesManifestCore }
    | InvalidCapability;
  readonly tutor:
    | { readonly status: "absent" }
    | {
      readonly status: "valid";
      readonly descriptor: TutorDescriptor;
      readonly bindings: ReadonlyMap<string, ExampleTutorBinding>;
    }
    | InvalidCapability;
};

export function parseCourseContentManifest(input: unknown): CourseContentValidation {
  const raw = asRecord(input);
  const rawExamples = Array.isArray(raw?.examples) ? raw.examples : undefined;
  const examples = parseExamplesCapability(input, raw, rawExamples);
  const hasTutorRoot = raw !== undefined && hasOwn(raw, "tutor");
  const hasTutorBinding = rawExamples?.some((example) => hasOwn(asRecord(example) ?? {}, "tutor")) ?? false;
  const tutor = parseTutorCapability(raw, rawExamples, hasTutorRoot || hasTutorBinding);
  return { examples, tutor };
}

function parseExamplesCapability(
  input: unknown,
  raw: Record<string, unknown> | undefined,
  rawExamples: unknown[] | undefined,
): CourseContentValidation["examples"] {
  const coreInput = raw === undefined ? input : withoutTutorData(raw, rawExamples);
  const coreParsed = courseContentCoreSchema.safeParse(coreInput);
  if (!coreParsed.success) return { status: "invalid", reason: "External Examples manifest is invalid" };
  try {
    validateManifestReferences(coreParsed.data);
    return { status: "valid", manifest: coreParsed.data };
  } catch {
    return { status: "invalid", reason: "External Examples snapshot is invalid" };
  }
}

function parseTutorCapability(
  raw: Record<string, unknown> | undefined,
  rawExamples: unknown[] | undefined,
  hasTutorCapability: boolean,
): CourseContentValidation["tutor"] {
  if (!hasTutorCapability) return { status: "absent" };
  if (raw?.schemaVersion !== 2) {
    return { status: "invalid", reason: "Tutor capability requires schema version 2" };
  }
  const descriptor = tutorDescriptorSchema.safeParse(raw.tutor);
  if (!descriptor.success) return { status: "invalid", reason: "Tutor descriptor is invalid" };
  const bindings = new Map<string, ExampleTutorBinding>();
  for (const example of rawExamples ?? []) {
    const entry = asRecord(example);
    if (!entry || !hasOwn(entry, "tutor")) continue;
    const binding = exampleTutorBindingSchema.safeParse(entry.tutor);
    const id = typeof entry.id === "string" ? entry.id : "unknown";
    if (!binding.success) return { status: "invalid", reason: `Tutor binding is invalid: ${id}` };
    bindings.set(id, binding.data);
  }
  return { status: "valid", descriptor: descriptor.data, bindings };
}

const courseContentCoreSchema = z.union([
  examplesManifestSchema,
  z.object({
    schemaVersion: z.literal(2),
    repository: z.string().max(256).optional(),
    ref: z.string().max(128).optional(),
    examples: z.array(manifestExampleSchema).max(1000),
  }).strict(),
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Reflect.getOwnPropertyDescriptor(value, key) !== undefined;
}

function withoutTutorData(raw: Record<string, unknown>, rawExamples: unknown[] | undefined): Record<string, unknown> {
  const { tutor: _tutor, examples: _examples, ...root } = raw;
  return {
    ...root,
    ...(rawExamples === undefined ? {} : {
      examples: rawExamples.map((example) => {
        const record = asRecord(example);
        if (!record) return example;
        const { tutor: _binding, ...core } = record;
        return core;
      }),
    }),
  };
}

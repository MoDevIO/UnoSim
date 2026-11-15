import { z } from "zod";
import { boundedArray } from "./bounded-array";
import { TUTOR_UML_PROFILE, type TutorUmlKind } from "./tutor-uml-profile";
export { TUTOR_UML_PROFILE, TUTOR_UML_LIMITS } from "./tutor-uml-profile";
export type { TutorUmlKind } from "./tutor-uml-profile";
export interface UmlCodeContext {
  readonly question: string;
  readonly code: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly entryFile: string;
  readonly board: string;
}
export const umlSourceRefSchema = z
  .strictObject({
    file: z.string().min(1).max(180),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine((r) => r.endLine >= r.startLine);
export type UmlSourceRef = z.infer<typeof umlSourceRefSchema>;
const text = z.string().trim().min(1).max(320);
const identifier = z
  .string()
  .regex(/^[A-Za-z_]\w*$/)
  .max(100);
export type UmlActivityStep =
  | { type: "action"; code: string; ref: UmlSourceRef }
  | {
      type: "decision";
      condition: string;
      ref: UmlSourceRef;
      whenTrue: UmlActivityStep[];
      whenFalse: UmlActivityStep[];
    }
  | {
      type: "loop";
      condition: string;
      ref: UmlSourceRef;
      body: UmlActivityStep[];
    };
const stepSchema: z.ZodType<UmlActivityStep> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("action"),
      code: text,
      ref: umlSourceRefSchema,
    }),
    z.strictObject({
      type: z.literal("decision"),
      condition: text,
      ref: umlSourceRefSchema,
      whenTrue: boundedArray(stepSchema, 12),
      whenFalse: boundedArray(stepSchema, 12),
    }),
    z.strictObject({
      type: z.literal("loop"),
      condition: text,
      ref: umlSourceRefSchema,
      body: boundedArray(stepSchema, 12, 1),
    }),
  ]),
);
const base = {
  version: z.literal(1),
  profile: z.literal(TUTOR_UML_PROFILE),
  status: z.literal("diagram"),
  purpose: text,
  scope: umlSourceRefSchema,
};
const umlFunctionActivityProposalSchema = z.strictObject({
  ...base,
  kind: z.literal("activity"),
  body: boundedArray(stepSchema, 12, 1),
});
/** Provider selects the callback view; runtime ordering/facts remain app-owned. */
export const umlArduinoActivityProposalSchema = z.strictObject({
  ...base,
  kind: z.literal("activity"),
  runtime: z.literal("arduino-setup-loop"),
  setup: z.strictObject({
    ref: umlSourceRefSchema,
    body: boundedArray(stepSchema, 12),
  }),
  loop: z.strictObject({
    ref: umlSourceRefSchema,
    body: boundedArray(stepSchema, 12),
  }),
});
/** One control statement, built by the application from the code; a provider cannot widen it. */
export const umlExcerptActivityProposalSchema = z.strictObject({
  ...base,
  kind: z.literal("activity"),
  excerpt: z.literal("statement"),
  body: boundedArray(stepSchema, 12, 1),
});
export type UmlExcerptActivityProposal = z.infer<
  typeof umlExcerptActivityProposalSchema
>;
export const umlActivityProposalSchema = z.union([
  umlFunctionActivityProposalSchema,
  umlExcerptActivityProposalSchema,
  umlArduinoActivityProposalSchema,
]);
export type UmlArduinoActivityProposal = z.infer<
  typeof umlArduinoActivityProposalSchema
>;
const member = z.strictObject({
  kind: z.enum(["attribute", "operation"]),
  declaration: text,
  visibility: z.enum(["public", "protected", "private"]),
  ref: umlSourceRefSchema,
});
export const umlClassProposalSchema = z.strictObject({
  ...base,
  kind: z.literal("class"),
  classes: boundedArray(
    z.strictObject({
      name: identifier,
      ref: umlSourceRefSchema,
      members: boundedArray(member, 24),
    }),
    12,
    1,
  ),
  relations: boundedArray(
    z.strictObject({
      kind: z.enum(["generalization", "association"]),
      from: identifier,
      to: identifier,
      ref: umlSourceRefSchema,
    }),
    24,
  ),
});
export const umlSequenceProposalSchema = z.strictObject({
  ...base,
  kind: z.literal("sequence"),
  participants: boundedArray(
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("context"),
        name: identifier,
        ref: umlSourceRefSchema,
      }),
      z.strictObject({
        kind: z.literal("object"),
        name: identifier,
        className: identifier,
        ref: umlSourceRefSchema,
      }),
    ]),
    12,
    2,
  ),
  messages: boundedArray(
    z.strictObject({
      type: z.enum(["call", "return"]),
      from: identifier,
      to: identifier,
      code: text,
      ref: umlSourceRefSchema,
    }),
    24,
    1,
  ),
});
export const umlNotUsefulProposalSchema = z.strictObject({
  version: z.literal(1),
  profile: z.literal(TUTOR_UML_PROFILE),
  status: z.literal("not-useful"),
  reason: z.enum([
    "irrelevant",
    "answer-leak",
    "ambiguous-question",
    "unsupported-code",
    "no-useful-context",
  ]),
  explanation: text,
});
export const tutorUmlProposalSchema = z.union([
  umlActivityProposalSchema,
  umlClassProposalSchema,
  umlSequenceProposalSchema,
  umlNotUsefulProposalSchema,
]);
export type UmlActivityProposal = z.infer<typeof umlActivityProposalSchema>;
export type UmlClassProposal = z.infer<typeof umlClassProposalSchema>;
export type UmlSequenceProposal = z.infer<typeof umlSequenceProposalSchema>;
export type UmlNotUsefulProposal = z.infer<typeof umlNotUsefulProposalSchema>;
export type UmlDiagramProposal =
  | UmlActivityProposal
  | UmlClassProposal
  | UmlSequenceProposal;
declare const validated: unique symbol;
/** Produced only by server validation; never supplied by a provider. */
export type ValidUmlProposal = UmlDiagramProposal & {
  readonly [validated]: true;
};
export type UmlValidationReason =
  | "proposal-too-large"
  | "invalid-schema"
  | "element-limit"
  | "irrelevant"
  | "answer-leak"
  | "unsupported-code"
  | "invalid-evidence";
export type UmlValidation =
  | { ok: true; proposal: ValidUmlProposal | UmlNotUsefulProposal }
  | { ok: false; reason: UmlValidationReason };
/** App-owned transport envelope. The provider schema deliberately excludes image and all renderer metadata. */
export interface TutorUmlDiagram {
  version: 1;
  profile: typeof TUTOR_UML_PROFILE;
  kind: TutorUmlKind;
  purpose: string;
  proposal: UmlDiagramProposal;
  image?: {
    svg: string;
    width: number;
    height: number;
    bytes: number;
    rendererRevision: string;
  };
}

/** Transport schema is app-owned and must never be merged into the provider proposal schema. */
export const tutorUmlImageSchema = z.strictObject({
  svg: z
    .string()
    .min(1)
    .max(512 * 1024),
  width: z.number().positive().max(2400),
  height: z.number().positive().max(4000),
  bytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
  rendererRevision: z.string().min(1).max(160),
});
export type TutorUmlImage = z.infer<typeof tutorUmlImageSchema>;
export const tutorUmlDiagramSchema = z
  .strictObject({
    version: z.literal(1),
    profile: z.literal(TUTOR_UML_PROFILE),
    kind: z.enum(["activity", "class", "sequence"]),
    purpose: text,
    proposal: z.union([
      umlActivityProposalSchema,
      umlClassProposalSchema,
      umlSequenceProposalSchema,
    ]),
    image: tutorUmlImageSchema.optional(),
  })
  .refine(
    (diagram) =>
      diagram.kind === diagram.proposal.kind &&
      diagram.purpose === diagram.proposal.purpose,
  );

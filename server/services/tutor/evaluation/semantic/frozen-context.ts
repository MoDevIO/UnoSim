import { tutorDialogTurnSchema, type TutorDialogTurn } from "@shared/tutor";
import { z } from "zod";
import { canonicalSemanticDigest, canonicalSemanticJson, deepFreeze, isSha256Digest } from "./semantic-canonical";

const courseContentContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free-tutor") }).strict(),
  z.object({
    kind: z.literal("repository-course-content"),
    reference: z.string().min(1),
    revision: z.string().min(1),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
]);

const frozenContextSchema = z.object({
  schemaVersion: z.literal("tutor-quality-frozen-context-v1"),
  sketchRef: z.string().min(1),
  sketchDigest: z.string().regex(/^[0-9a-f]{64}$/),
  question: z.string().min(1),
  learnerAnswer: z.object({
    text: z.string().min(1),
    category: z.enum(["fully-correct", "partially-correct", "typical-misconception", "terminology-confusion", "correct-poorly-phrased", "explicitly-unknown", "off-topic", "unexpectedly-strong"]),
    bindsToQuestion: z.string().min(1),
  }).strict(),
  priorDialog: z.array(z.unknown()),
  courseContent: courseContentContextSchema,
  difficulty: z.number().int().min(1).max(100),
  digest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict();

export type FrozenPreTurnContextInput = Omit<z.infer<typeof frozenContextSchema>, "digest"> & { readonly digest?: string };
export interface FrozenPreTurnContext extends Omit<z.infer<typeof frozenContextSchema>, "priorDialog" | "digest"> {
  readonly priorDialog: readonly TutorDialogTurn[];
  readonly digest: string;
}

export type FrozenPreTurnContextValidation =
  | { readonly valid: true; readonly context: FrozenPreTurnContext }
  | { readonly valid: false; readonly reason: string };

function parseInput(input: unknown): FrozenPreTurnContextInput {
  const parsed = frozenContextSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`).join("; ");
    throw new Error(`Invalid Frozen Pre-Turn Context: ${details}`);
  }
  if (parsed.data.question !== parsed.data.learnerAnswer.bindsToQuestion) {
    throw new Error("Invalid Frozen Pre-Turn Context: learner answer must bind to the exact preceding question");
  }
  const priorDialog: TutorDialogTurn[] = [];
  for (const [index, rawTurn] of parsed.data.priorDialog.entries()) {
    const turn = tutorDialogTurnSchema.safeParse(rawTurn);
    if (!turn.success || canonicalSemanticJson(turn.data) !== canonicalSemanticJson(rawTurn)) {
      throw new Error(`Invalid Frozen Pre-Turn Context: priorDialog[${index}] is invalid or would require normalization`);
    }
    priorDialog.push(turn.data);
  }
  return { ...parsed.data, priorDialog } as FrozenPreTurnContextInput;
}

function digestInput(input: FrozenPreTurnContextInput): Record<string, unknown> {
  const { digest: _digest, ...source } = input;
  return source;
}

export function createFrozenPreTurnContext(input: FrozenPreTurnContextInput): FrozenPreTurnContext {
  const parsed = parseInput(input);
  const digest = canonicalSemanticDigest(digestInput(parsed));
  if (parsed.digest !== undefined && parsed.digest !== digest) {
    throw new Error("Invalid Frozen Pre-Turn Context: digest does not match its canonical content");
  }
  if (!isSha256Digest(digest)) throw new Error("Invalid Frozen Pre-Turn Context: unable to produce a valid digest");
  return deepFreeze({ ...parsed, digest }) as FrozenPreTurnContext;
}

export function validateFrozenPreTurnContext(input: unknown): FrozenPreTurnContextValidation {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input) || !isSha256Digest((input as { digest?: unknown }).digest)) {
      return { valid: false, reason: "missing-or-invalid-context-digest" };
    }
    return { valid: true, context: createFrozenPreTurnContext(input as FrozenPreTurnContextInput) };
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "invalid-frozen-context" };
  }
}

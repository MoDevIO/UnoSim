import { z } from "zod";
import type { TutorPlanningContentContext } from "../../tutor-planning";
import { canonicalSemanticDigest, canonicalSemanticJson, semanticSha256 } from "./semantic-canonical";
import { validateFrozenPreTurnContext, type FrozenPreTurnContext } from "./frozen-context";
import {
  SEMANTIC_ANSWER_CATEGORIES,
  SEMANTIC_CASE_ROLES,
  SEMANTIC_EVIDENCE_SOURCE_KINDS,
  SEMANTIC_RUBRIC_DIMENSIONS,
  type SemanticCaseRole,
  type SemanticEvidenceSource,
  type SemanticRubricDimension,
} from "./semantic-types";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const evidenceSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SEMANTIC_EVIDENCE_SOURCE_KINDS),
  reference: z.string().min(1),
  digest: digestSchema,
}).strict();

const factualReferenceBundleSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().min(1),
  sourceKind: z.enum(["draft-factual-reference", "reviewed-factual-reference"]),
  reviewStatus: z.enum(["pending-review", "reviewed"]),
  provenance: z.string().min(1),
  limitations: z.array(z.string().min(1)),
  facts: z.array(z.object({ id: z.string().min(1), statement: z.string().min(1) }).strict()).min(1),
  digest: digestSchema.optional(),
}).strict();

const acceptableResponsesSchema = z.object({
  diagnoses: z.array(z.string().min(1)).min(1),
  feedbackApproaches: z.array(z.string().min(1)).min(1),
  followUps: z.array(z.string().min(1)).min(1),
}).strict();

const semanticCaseSchema = z.object({
  id: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/),
  caseVersion: z.number().int().min(1),
  digest: digestSchema.optional(),
  purpose: z.string().min(1),
  role: z.enum(SEMANTIC_CASE_ROLES),
  sketch: z.object({ reference: z.string().min(1), digest: digestSchema }).strict(),
  frozenPreTurnContext: z.unknown(),
  expectedAnswerInterpretation: z.string().min(1),
  acceptableTutorResponses: acceptableResponsesSchema,
  answerCategory: z.enum(SEMANTIC_ANSWER_CATEGORIES),
  knownFailurePatterns: z.array(z.string().min(1)).min(1),
  assessableDimensions: z.array(z.enum(SEMANTIC_RUBRIC_DIMENSIONS)).min(1),
  dimensionEvidenceLimitations: z.record(z.string(), z.string().min(1)),
  evidenceSources: z.array(evidenceSourceSchema).min(1),
  permittedExternalKnowledge: z.boolean(),
  factualReferenceBundle: factualReferenceBundleSchema,
  humanReference: z.object({ status: z.literal("pending-review") }).strict(),
}).strict();

const corpusSchema = z.object({
  schemaVersion: z.literal("tutor-quality-semantic-corpus-v1"),
  corpusId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  corpusVersion: z.number().int().min(1),
  digest: digestSchema.optional(),
  cases: z.array(semanticCaseSchema).min(1),
}).strict();

export type SemanticCorpusReferences = {
  readonly sketches: ReadonlyMap<string, string>;
  readonly courseContent: ReadonlyMap<string, TutorPlanningContentContext>;
};

export interface SemanticFactualReferenceBundle {
  readonly id: string;
  readonly version: number;
  readonly sourceKind: "draft-factual-reference" | "reviewed-factual-reference";
  readonly reviewStatus: "pending-review" | "reviewed";
  readonly provenance: string;
  readonly limitations: readonly string[];
  readonly facts: readonly { readonly id: string; readonly statement: string }[];
  readonly digest: string;
}

export interface SemanticCase {
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly id: string;
  readonly caseVersion: number;
  readonly digest: string;
  readonly purpose: string;
  readonly role: SemanticCaseRole;
  readonly sketch: { readonly reference: string; readonly digest: string };
  readonly frozenPreTurnContext: FrozenPreTurnContext;
  readonly expectedAnswerInterpretation: string;
  readonly acceptableTutorResponses: {
    readonly diagnoses: readonly string[];
    readonly feedbackApproaches: readonly string[];
    readonly followUps: readonly string[];
  };
  readonly answerCategory: typeof SEMANTIC_ANSWER_CATEGORIES[number];
  readonly knownFailurePatterns: readonly string[];
  readonly assessableDimensions: readonly SemanticRubricDimension[];
  readonly dimensionEvidenceLimitations: Readonly<Record<string, string>>;
  readonly evidenceSources: readonly SemanticEvidenceSource[];
  readonly permittedExternalKnowledge: boolean;
  readonly factualReferenceBundle: SemanticFactualReferenceBundle;
  readonly humanReference: { readonly status: "pending-review" | "reviewed" | "disputed" | "adjudicated" };
}

export interface SemanticCorpus {
  readonly schemaVersion: "tutor-quality-semantic-corpus-v1";
  readonly corpusId: string;
  readonly corpusVersion: number;
  readonly cases: readonly SemanticCase[];
  readonly digest: string;
}

export type SemanticCorpusSource = Omit<z.infer<typeof corpusSchema>, "digest"> & { readonly digest?: string };
export type SemanticCorpusEvolutionComparison =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "version-not-increased" | "version-regressed" };

export function factualReferenceBundleDigest(bundle: Omit<SemanticFactualReferenceBundle, "digest"> | Record<string, unknown>): string {
  const { digest: _digest, ...source } = bundle as Record<string, unknown>;
  const facts = Array.isArray(source.facts)
    ? [...source.facts as Array<Record<string, unknown>>].sort((left, right) => compareUtf8(String(left.id), String(right.id)))
    : source.facts;
  const limitations = Array.isArray(source.limitations) ? [...source.limitations as string[]].sort(compareUtf8) : source.limitations;
  return canonicalSemanticDigest({ ...source, ...(facts ? { facts } : {}), ...(limitations ? { limitations } : {}) });
}

function caseContentWithoutDigest(semanticCase: Omit<SemanticCase, "digest"> | SemanticCase | Record<string, unknown>): Record<string, unknown> {
  const { digest: _digest, corpusId: _corpusId, corpusVersion: _corpusVersion, ...source } = semanticCase as Record<string, unknown>;
  return source;
}

function normalizedCase(semanticCase: SemanticCase): Record<string, unknown> {
  const source = caseContentWithoutDigest(semanticCase) as Omit<SemanticCase, "digest" | "corpusId" | "corpusVersion">;
  return {
    ...source,
    acceptableTutorResponses: {
      diagnoses: [...source.acceptableTutorResponses.diagnoses].sort(compareUtf8),
      feedbackApproaches: [...source.acceptableTutorResponses.feedbackApproaches].sort(compareUtf8),
      followUps: [...source.acceptableTutorResponses.followUps].sort(compareUtf8),
    },
    knownFailurePatterns: [...source.knownFailurePatterns].sort(compareUtf8),
    assessableDimensions: [...source.assessableDimensions].sort(compareUtf8),
    evidenceSources: [...source.evidenceSources].sort((left, right) => compareUtf8(left.id, right.id)),
    factualReferenceBundle: {
      ...source.factualReferenceBundle,
      digest: factualReferenceBundleDigest(source.factualReferenceBundle),
      limitations: [...source.factualReferenceBundle.limitations].sort(compareUtf8),
      facts: [...source.factualReferenceBundle.facts].sort((left, right) => compareUtf8(left.id, right.id)),
    },
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizedCaseSource(caseItem: Record<string, unknown>): Record<string, unknown> {
  const source = caseContentWithoutDigest(caseItem);
  const acceptable = source.acceptableTutorResponses as Record<string, unknown> | undefined;
  const bundle = source.factualReferenceBundle as Record<string, unknown> | undefined;
  return {
    ...source,
    ...(acceptable ? {
      acceptableTutorResponses: Object.fromEntries(Object.entries(acceptable).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value as string[]].sort(compareUtf8) : value,
      ])),
    } : {}),
    ...(Array.isArray(source.knownFailurePatterns) ? { knownFailurePatterns: [...source.knownFailurePatterns as string[]].sort(compareUtf8) } : {}),
    ...(Array.isArray(source.assessableDimensions) ? { assessableDimensions: [...source.assessableDimensions as string[]].sort(compareUtf8) } : {}),
    ...(Array.isArray(source.evidenceSources) ? {
      evidenceSources: [...source.evidenceSources as Array<Record<string, unknown>>].sort((left, right) => compareUtf8(String(left.id), String(right.id))),
    } : {}),
    ...(bundle ? {
      factualReferenceBundle: {
        ...bundle,
        digest: factualReferenceBundleDigest(bundle),
        ...(Array.isArray(bundle.limitations) ? { limitations: [...bundle.limitations as string[]].sort(compareUtf8) } : {}),
        ...(Array.isArray(bundle.facts) ? {
          facts: [...bundle.facts as Array<Record<string, unknown>>].sort((left, right) => compareUtf8(String(left.id), String(right.id))),
        } : {}),
      },
    } : {}),
  };
}

function normalizedCorpus(corpus: Pick<SemanticCorpus, "schemaVersion" | "corpusId" | "corpusVersion" | "cases">) {
  return {
    schemaVersion: corpus.schemaVersion,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    cases: [...corpus.cases].map(normalizedCase).sort((left, right) => compareUtf8(String(left.id), String(right.id))),
  };
}

export function semanticCorpusDigest(corpus: unknown): string {
  if (corpus === null || typeof corpus !== "object" || Array.isArray(corpus)) throw new TypeError("Semantic Corpus must be an object");
  const source = corpus as Record<string, unknown>;
  if (!Array.isArray(source.cases)) throw new TypeError("Semantic Corpus cases must be an array");
  const cases = source.cases.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Semantic Corpus case must be an object");
    const caseItem = item as Record<string, unknown>;
    return normalizedCaseSource(caseItem);
  });
  return canonicalSemanticDigest({
    schemaVersion: source.schemaVersion,
    corpusId: source.corpusId,
    corpusVersion: source.corpusVersion,
    cases: cases.toSorted((left, right) => compareUtf8(String(left.id), String(right.id))),
  });
}

function semanticCorpusContentDigest(corpus: SemanticCorpus): string {
  return canonicalSemanticDigest({
    schemaVersion: corpus.schemaVersion,
    corpusId: corpus.corpusId,
    cases: [...corpus.cases].map(normalizedCase).sort((left, right) => compareUtf8(String(left.id), String(right.id))),
  });
}

export function semanticCaseDigest(semanticCase: SemanticCase): string {
  return canonicalSemanticDigest(normalizedCase(semanticCase));
}

function invalidCorpus(message: string): never {
  throw new Error(`Invalid Stage-2B Semantic Corpus: ${message}`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalidCorpus(`${label} must be duplicate-free`);
}

function checkSketchReferences(semanticCase: SemanticCase, references: SemanticCorpusReferences): void {
  if (semanticCase.frozenPreTurnContext.sketchRef !== semanticCase.sketch.reference
    || semanticCase.frozenPreTurnContext.sketchDigest !== semanticCase.sketch.digest) {
    invalidCorpus(`${semanticCase.id} Frozen Pre-Turn Context must bind to the exact Semantic Case sketch and digest`);
  }
  const sketch = references.sketches.get(semanticCase.sketch.reference);
  if (sketch === undefined) invalidCorpus(`${semanticCase.id} references missing sketch ${semanticCase.sketch.reference}`);
  if (semanticSha256(sketch) !== semanticCase.sketch.digest) invalidCorpus(`${semanticCase.id} sketch digest does not match fixture bytes`);
  const sourceSketch = semanticCase.evidenceSources.find(({ id }) => id === "sketch");
  if (sourceSketch?.kind !== "repository/sketch" || sourceSketch?.reference !== semanticCase.sketch.reference || sourceSketch?.digest !== semanticCase.sketch.digest) {
    invalidCorpus(`${semanticCase.id} must identify its exact sketch as repository/sketch evidence`);
  }
}

function checkFactualReference(semanticCase: SemanticCase): void {
  const factualSource = semanticCase.evidenceSources.find(({ kind }) => kind === semanticCase.factualReferenceBundle.sourceKind);
  if (factualSource?.reference !== semanticCase.factualReferenceBundle.id || factualSource?.digest !== semanticCase.factualReferenceBundle.digest) {
    invalidCorpus(`${semanticCase.id} factual reference source must bind to its bundle identity and digest`);
  }
  if (semanticCase.factualReferenceBundle.sourceKind === "draft-factual-reference" && semanticCase.factualReferenceBundle.reviewStatus !== "pending-review") {
    invalidCorpus(`${semanticCase.id} draft factual references must remain pending review`);
  }
  if (semanticCase.factualReferenceBundle.sourceKind === "reviewed-factual-reference" && semanticCase.factualReferenceBundle.reviewStatus !== "reviewed") {
    invalidCorpus(`${semanticCase.id} reviewed factual references must be marked reviewed`);
  }
}

function checkExternalEvidencePolicy(semanticCase: SemanticCase): void {
  const hasExternalSource = semanticCase.evidenceSources.some(({ kind }) => kind === "permitted-external-knowledge");
  if (hasExternalSource !== semanticCase.permittedExternalKnowledge) invalidCorpus(`${semanticCase.id} external evidence and evidence policy disagree`);
}

function checkCourseContentReferences(semanticCase: SemanticCase, references: SemanticCorpusReferences): void {
  const courseSources = semanticCase.evidenceSources.filter(({ kind }) => kind === "repository/course-content");
  if (semanticCase.frozenPreTurnContext.courseContent.kind === "repository-course-content") {
    if (courseSources.length !== 1
      || courseSources[0].reference !== semanticCase.frozenPreTurnContext.courseContent.reference
      || courseSources[0].digest !== semanticCase.frozenPreTurnContext.courseContent.digest) {
      invalidCorpus(`${semanticCase.id} repository Course Content evidence must bind to its exact context reference and digest`);
    }
  } else if (courseSources.length > 0) {
    invalidCorpus(`${semanticCase.id} cannot claim repository Course Content evidence without a Course Content context`);
  }
  if (semanticCase.frozenPreTurnContext.courseContent.kind === "repository-course-content") {
    const content = references.courseContent.get(semanticCase.frozenPreTurnContext.courseContent.reference);
    if (!content) invalidCorpus(`${semanticCase.id} references missing Course Content ${semanticCase.frozenPreTurnContext.courseContent.reference}`);
    if (content.revision !== semanticCase.frozenPreTurnContext.courseContent.revision) invalidCorpus(`${semanticCase.id} Course Content revision does not match its fixture`);
    if (canonicalSemanticDigest(content) !== semanticCase.frozenPreTurnContext.courseContent.digest) invalidCorpus(`${semanticCase.id} Course Content digest does not match its fixture`);
  }
}

function checkCaseReferences(semanticCase: SemanticCase, references: SemanticCorpusReferences): void {
  checkSketchReferences(semanticCase, references);
  checkFactualReference(semanticCase);
  checkExternalEvidencePolicy(semanticCase);
  checkCourseContentReferences(semanticCase, references);
}

export function parseSemanticCorpus(input: unknown, references: SemanticCorpusReferences): SemanticCorpus {
  const parsed = corpusSchema.safeParse(input);
  if (!parsed.success) invalidCorpus(parsed.error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`).join("; "));
  const ids = parsed.data.cases.map(({ id }) => id);
  assertUnique(ids, "case IDs");
  const cases = parsed.data.cases.map((rawCase) => {
    const context = validateFrozenPreTurnContext(rawCase.frozenPreTurnContext);
    if (!context.valid) invalidCorpus(`${rawCase.id} has invalid Frozen Pre-Turn Context: ${context.reason}`);
    const bundleInput = rawCase.factualReferenceBundle;
    const facts = [...bundleInput.facts].sort((left, right) => compareUtf8(left.id, right.id));
    assertUnique(facts.map(({ id }) => id), `${rawCase.id} factual-reference fact IDs`);
    assertUnique(bundleInput.limitations, `${rawCase.id} factual-reference limitations`);
    const bundleSource = {
      id: bundleInput.id,
      version: bundleInput.version,
      sourceKind: bundleInput.sourceKind,
      reviewStatus: bundleInput.reviewStatus,
      provenance: bundleInput.provenance,
      limitations: [...bundleInput.limitations].sort(compareUtf8),
      facts,
    };
    const bundleDigest = factualReferenceBundleDigest(bundleSource);
    if (bundleInput.digest !== undefined && bundleInput.digest !== bundleDigest) invalidCorpus(`${rawCase.id} factual reference digest does not match bundle content`);
    const dimensions = rawCase.assessableDimensions;
    assertUnique(dimensions, `${rawCase.id} assessable dimensions`);
    const limitationKeys = Object.keys(rawCase.dimensionEvidenceLimitations);
    for (const key of limitationKeys) {
      if (!(SEMANTIC_RUBRIC_DIMENSIONS as readonly string[]).includes(key)) invalidCorpus(`${rawCase.id} declares an unknown rubric dimension limitation ${key}`);
    }
    for (const dimension of SEMANTIC_RUBRIC_DIMENSIONS) {
      if (!dimensions.includes(dimension) && !limitationKeys.includes(dimension)) invalidCorpus(`${rawCase.id} must explain why ${dimension} is not assessable`);
      if (dimensions.includes(dimension) && limitationKeys.includes(dimension)) invalidCorpus(`${rawCase.id} cannot both assess and declare an evidence limitation for ${dimension}`);
    }
    assertUnique(rawCase.knownFailurePatterns, `${rawCase.id} known failure patterns`);
    assertUnique(rawCase.acceptableTutorResponses.diagnoses, `${rawCase.id} acceptable diagnoses`);
    assertUnique(rawCase.acceptableTutorResponses.feedbackApproaches, `${rawCase.id} acceptable feedback approaches`);
    assertUnique(rawCase.acceptableTutorResponses.followUps, `${rawCase.id} acceptable follow-ups`);
    assertUnique(rawCase.evidenceSources.map(({ id }) => id), `${rawCase.id} evidence source IDs`);
    const { digest: declaredCaseDigest, ...rawCaseContent } = rawCase;
    const semanticCaseWithoutDigest: Omit<SemanticCase, "digest" | "corpusId" | "corpusVersion"> = {
      ...rawCaseContent,
      sketch: { ...rawCase.sketch },
      frozenPreTurnContext: context.context,
      acceptableTutorResponses: {
        diagnoses: [...rawCase.acceptableTutorResponses.diagnoses].sort(compareUtf8),
        feedbackApproaches: [...rawCase.acceptableTutorResponses.feedbackApproaches].sort(compareUtf8),
        followUps: [...rawCase.acceptableTutorResponses.followUps].sort(compareUtf8),
      },
      knownFailurePatterns: [...rawCase.knownFailurePatterns].sort(compareUtf8),
      assessableDimensions: [...dimensions].sort(compareUtf8),
      dimensionEvidenceLimitations: { ...rawCase.dimensionEvidenceLimitations },
      evidenceSources: [...rawCase.evidenceSources].sort((left, right) => compareUtf8(left.id, right.id)),
      factualReferenceBundle: { ...bundleSource, digest: bundleDigest },
      humanReference: { ...rawCase.humanReference },
    };
    const caseDigest = canonicalSemanticDigest(semanticCaseWithoutDigest);
    if (declaredCaseDigest !== undefined && declaredCaseDigest !== caseDigest) invalidCorpus(`${rawCase.id} case digest does not match content`);
    const semanticCase: SemanticCase = {
      ...semanticCaseWithoutDigest,
      corpusId: parsed.data.corpusId,
      corpusVersion: parsed.data.corpusVersion,
      digest: caseDigest,
    };
    checkCaseReferences(semanticCase, references);
    return semanticCase;
  }).sort((left, right) => compareUtf8(left.id, right.id));

  const corpusWithoutDigest = {
    schemaVersion: parsed.data.schemaVersion,
    corpusId: parsed.data.corpusId,
    corpusVersion: parsed.data.corpusVersion,
    cases,
  } as const;
  const digest = semanticCorpusDigest(corpusWithoutDigest);
  if (parsed.data.digest !== undefined && parsed.data.digest !== digest) invalidCorpus("corpus digest does not match parsed content");
  return { ...corpusWithoutDigest, digest };
}

export function compareSemanticCorpusVersions(previous: SemanticCorpus, current: SemanticCorpus): SemanticCorpusEvolutionComparison {
  if (current.corpusVersion < previous.corpusVersion) return { valid: false, reason: "version-regressed" };
  const changed = semanticCorpusContentDigest(previous) !== semanticCorpusContentDigest(current);
  if (changed && current.corpusVersion <= previous.corpusVersion) return { valid: false, reason: "version-not-increased" };
  return { valid: true };
}

export function semanticCorpusCanonicalJson(corpus: SemanticCorpus): string {
  return canonicalSemanticJson(normalizedCorpus(corpus));
}

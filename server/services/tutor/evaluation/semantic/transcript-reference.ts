import type { TutorQualityTranscript } from "../real-provider-evaluation";
import { canonicalSemanticDigest, canonicalSemanticJson, isSha256Digest } from "./semantic-canonical";
import type { Stage2ATranscriptProvenance } from "./stage2a-transcript";

export interface Stage2ATranscriptReference {
  readonly schemaVersion: "tutor-quality-stage2b-transcript-reference-v1";
  readonly stageAEvaluationIdentity: string;
  readonly transcriptDigest: string;
  readonly compatibilityMappingIdentity: string;
  readonly compatibilityMappingKind: Stage2ATranscriptProvenance["kind"];
  readonly identity: string;
}

export function canonicalStage2ATranscriptJson(transcript: TutorQualityTranscript): string {
  return canonicalSemanticJson(transcript);
}

/** Stage 2B's own canonical digest of an immutable Stage-2A transcript. */
export function stage2bTranscriptDigest(transcript: TutorQualityTranscript): string {
  return canonicalSemanticDigest(transcript);
}

export function createStage2ATranscriptReference(
  transcript: TutorQualityTranscript,
  transcriptDigest: string,
  compatibilityMapping: Stage2ATranscriptProvenance,
): Stage2ATranscriptReference {
  if (!isSha256Digest(transcript.evaluationIdentity)) throw new Error("Stage-2A evaluationIdentity is missing or invalid");
  if (!isSha256Digest(transcriptDigest) || transcriptDigest !== stage2bTranscriptDigest(transcript)) {
    throw new Error("Stage-B transcriptDigest does not match the immutable Stage-2A transcript");
  }
  if (!compatibilityMapping || !isSha256Digest(compatibilityMapping.identity)) throw new Error("Stage-B compatibility mapping identity is invalid");
  const { identity: _mappingIdentity, ...mappingContent } = compatibilityMapping;
  if (compatibilityMapping.identity !== canonicalSemanticDigest(mappingContent)) throw new Error("Stage-B compatibility mapping digest does not match its content");
  if (compatibilityMapping.kind === "existing-transcript-compatibility"
    && compatibilityMapping.sourceEvaluationIdentity !== transcript.evaluationIdentity) {
    throw new Error("Existing Stage-A transcript identity does not match its compatibility mapping");
  }
  const identitySource = {
    schemaVersion: "tutor-quality-stage2b-transcript-reference-v1" as const,
    stageAEvaluationIdentity: transcript.evaluationIdentity,
    transcriptDigest,
    compatibilityMappingIdentity: compatibilityMapping.identity,
    compatibilityMappingKind: compatibilityMapping.kind,
  };
  return { ...identitySource, identity: canonicalSemanticDigest(identitySource) };
}

export { canonicalSemanticJson as canonicalStage2BJson };

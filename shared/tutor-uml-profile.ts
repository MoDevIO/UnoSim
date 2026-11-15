/** Small browser-safe constants for the explicitly negotiated classic UML profile. */
export const TUTOR_UML_PROFILE = "uml1-classic-v1" as const;
export const TUTOR_UML_KINDS = ["activity", "class", "sequence"] as const;
export type TutorUmlKind = typeof TUTOR_UML_KINDS[number];
export const TUTOR_UML_LIMITS = {
  proposalBytes: 16 * 1024, nodes: 12, edges: 24, members: 24,
  imageBytes: 512 * 1024, width: 2400, height: 4000, fontSize: 14,
  browserBytes: 4 * 1024 * 1024,
} as const;

/** Shared policy for the deliberately small, locally rendered Tutor graphic format. */
export const TUTOR_MERMAID_MAX_CHARS = 12_000;
export type TutorMermaidRejection =
  | "too-long" | "empty" | "diagram-type-unsupported" | "markup-disallowed"
  | "external-content-disallowed" | "directive-disallowed" | "syntax-unsupported"
  | "no-renderable-graph" | "invalid-marker-id";
export type TutorDiagramType = "flowchart" | "graph" | "stateDiagram-v2" | "sequenceDiagram" | "unknown";

export function tutorDiagramType(source: string): TutorDiagramType {
  switch (source.trim().split(/\s+/, 1)[0]?.toLowerCase()) {
    case "flowchart": return "flowchart";
    case "graph": return "graph";
    case "statediagram-v2": return "stateDiagram-v2";
    case "sequencediagram": return "sequenceDiagram";
    default: return "unknown";
  }
}

export function checkTutorMermaid(source: string): TutorMermaidRejection | null {
  if (source.length > TUTOR_MERMAID_MAX_CHARS) return "too-long";
  if (!source.trim()) return "empty";
  if (tutorDiagramType(source) === "unknown") return "diagram-type-unsupported";
  // Comparisons such as x<b && c>d are text, not opening HTML tags.
  // The renderer independently escapes every SVG label.
  if (/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s*\/?>|\s+[A-Za-z_:][^<>]*>|\/[A-Za-z_:][^<>]*>)/.test(source) || /<[!?]/.test(source)) return "markup-disallowed";
  if (/https?:\/\/|javascript:/i.test(source)) return "external-content-disallowed";
  // Only spaces and tabs may follow the line or statement start: a class that also matched line breaks
  // would overlap the start alternative and backtrack quadratically on runs of blank lines.
  if (/%%\{|(?:^|[\r\n;])[^\S\r\n]*(?:click|classDef|linkStyle)\b/i.test(source)) return "directive-disallowed";
  return null;
}

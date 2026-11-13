export const UML_RENDER_LIMITS = {
  timeoutMs: 10_000,
  active: 2,
  queued: 8,
  heapMiB: 256,
  globalArtifactBytes: 64 * 1024 * 1024,
  ownerArtifactBytes: 8 * 1024 * 1024,
  sessionArtifactBytes: 4 * 1024 * 1024,
} as const;
export const UML_RENDERER_REVISION =
  "plantuml-mit-1.2026.10:smetana:dejavu-2.37:classic-v1";
export class UmlRenderError extends Error {
  constructor(
    readonly kind:
      | "render-output-invalid"
      | "renderer-unavailable"
      | "renderer-timeout"
      | "renderer-failed"
      | "render-queue-limit"
      | "render-artifact-limit",
  ) {
    super(kind);
    this.name = "UmlRenderError";
  }
}

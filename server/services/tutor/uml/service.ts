import { canonicalDigest } from "../canonical";
import { tutorUmlProposalSchema } from "@shared/tutor-uml";
import { AsyncLocalStorage } from "node:async_hooks";
import type { TutorContentResult } from "@shared/tutor";
import type {
  TutorUmlDiagram,
  UmlCodeContext,
  UmlValidation,
  ValidUmlProposal,
} from "@shared/tutor-uml";
import {
  TUTOR_UML_PROFILE,
  TUTOR_UML_LIMITS,
  type TutorUmlKind,
} from "@shared/tutor-uml-profile";
import type { TutorGraphicsMode } from "@shared/tutor-graphics";
import type { LLMProvider } from "../llm-provider";
import {
  beginTutorProviderAttempt,
  reportTutorDiagnostic,
  reportTutorModel,
  reportTutorReview,
} from "../tutor-diagnostics";
import {
  TutorUmlArtifacts,
  type TutorUmlArtifactHandle,
  type TutorUmlReservation,
} from "./artifacts";
import { TutorUmlRenderer } from "./renderer";
import { validateTutorUmlProposal } from "./validate";
import { exportTutorUml } from "./export";
import { TUTOR_UML_PROMPT_DIRECTIVES, UML_PROMPT_REVISION } from "./prompt";
import { UML_RENDERER_REVISION, UmlRenderError } from "./limits";
import type { RenderedUmlImage } from "./svg";
import type {
  SupportArtifactReferences,
  TutorSupportLifecycleHooks,
} from "../learning-support-store";

export const tutorUmlArtifacts = new TutorUmlArtifacts<TutorUmlDiagram>();
export const tutorUmlRenderer = new TutorUmlRenderer();
interface ArtifactScope {
  owner?: string;
  session?: string;
  releases: Array<() => void>;
  closed?: boolean;
}
const scopes = new AsyncLocalStorage<ArtifactScope>();
const bindings = new WeakMap<
  TutorUmlArtifactHandle,
  { question: string; fingerprint: string }
>();
/** Express middleware enters once; finish/close invokes the returned idempotent cleanup. */
export function enterTutorUmlArtifacts(
  owner: string | undefined,
  session: string | undefined,
  next: () => void,
): () => void {
  const scope: ArtifactScope = { owner, session, releases: [] };
  scopes.run(scope, next);
  return () => {
    if (scope.closed) {
      return;
    }
    scope.closed = true;
    for (const release of scope.releases) release();
  };
}
export interface PreparedTutorUml {
  readonly graphicStatus?: "provided" | "not-useful" | "unavailable";
  readonly diagram?: TutorUmlDiagram;
  readonly _diagramArtifact?: TutorUmlArtifactHandle;
}
interface PreparationOptions {
  readonly mode?: TutorGraphicsMode;
  readonly proposal?: unknown;
  readonly model: string;
  readonly credential: string;
  readonly signal?: AbortSignal;
  readonly renderer?: {
    available(): Promise<boolean>;
    render(
      source: string,
      kind: TutorUmlKind,
      signal?: AbortSignal,
    ): Promise<RenderedUmlImage>;
  };
  readonly artifacts?: TutorUmlArtifacts<TutorUmlDiagram>;
}
/** Review keeps only schema-normalized candidates within the original proposal budget. */
function normalizedReviewCandidate(input: unknown): unknown {
  try {
    const serialized = JSON.stringify(input);
    if (
      !serialized ||
      Buffer.byteLength(serialized) > TUTOR_UML_LIMITS.proposalBytes
    )
      return undefined;
    const parsed = tutorUmlProposalSchema.safeParse(input);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
type PreparationReport = (
  state: "provided" | "not-useful" | "unavailable" | "rejected",
  reason?: Parameters<typeof reportTutorDiagnostic>[0]["reason"],
  normalized?: unknown,
) => void;
function initialDisposition(
  primary: UmlValidation | undefined,
  mode: TutorGraphicsMode | undefined,
  report: PreparationReport,
): PreparedTutorUml | undefined {
  if (primary && !primary.ok) report("rejected", primary.reason);
  if (primary?.ok && primary.proposal.status === "not-useful") {
    report("not-useful", primary.proposal.reason, primary.proposal);
    return { graphicStatus: "not-useful" };
  }
  if (!primary?.ok && mode !== "always")
    return primary ? { graphicStatus: "unavailable" } : {};
  return undefined;
}
async function generateProposal(
  generate: NonNullable<LLMProvider["generateGraphic"]>,
  context: UmlCodeContext,
  options: PreparationOptions,
): Promise<unknown> {
  const response = await generate(
    {
      model: options.model,
      systemPrompt: `Erzeuge ausschließlich ein JSON-Objekt mit dem Feld diagram.\n${TUTOR_UML_PROMPT_DIRECTIVES}`,
      userPrompt: JSON.stringify(context),
    },
    options.credential,
    options.signal,
  );
  options.signal?.throwIfAborted();
  reportTutorModel(options.model, response.model);
  return response.model &&
    response.result &&
    typeof response.result === "object" &&
    !Array.isArray(response.result) &&
    Object.keys(response.result).length === 1 &&
    "diagram" in response.result
    ? response.result.diagram
    : undefined;
}
function failureReason(
  error: unknown,
  rendering: boolean,
): Parameters<typeof reportTutorDiagnostic>[0]["reason"] {
  if (error instanceof UmlRenderError) return error.kind;
  return rendering ? "renderer-failed" : "provider-unavailable";
}
function preparationFailed(
  error: unknown,
  rendering: boolean,
  signal: AbortSignal | undefined,
  report: PreparationReport,
): PreparedTutorUml {
  if (signal?.aborted) {
    reportTutorDiagnostic({
      origin: "renderer",
      stage: "renderer",
      outcome: "aborted",
      reason: "request-aborted",
      graphicsProfile: TUTOR_UML_PROFILE,
    });
    signal.throwIfAborted();
  }
  const reason = failureReason(error, rendering);
  if (rendering)
    reportTutorDiagnostic({
      origin: "renderer",
      stage: "renderer",
      outcome: "failed",
      reason,
      graphicsProfile: TUTOR_UML_PROFILE,
    });
  report("unavailable", reason);
  return { graphicStatus: "unavailable" };
}
interface RenderingOptions {
  renderer: NonNullable<PreparationOptions["renderer"]>;
  artifacts: TutorUmlArtifacts<TutorUmlDiagram>;
  reservation: TutorUmlReservation;
  scope?: ArtifactScope;
  signal?: AbortSignal;
  report: PreparationReport;
  onStart: () => void;
  onCommit: () => void;
}
async function renderPreparedUml(
  proposal: ValidUmlProposal,
  context: UmlCodeContext,
  options: RenderingOptions,
): Promise<PreparedTutorUml> {
  const {
    renderer,
    artifacts,
    reservation,
    scope,
    signal,
    report,
    onStart,
    onCommit,
  } = options;
  reportTutorDiagnostic({
    origin: "renderer",
    stage: "renderer",
    outcome: "started",
    graphicsProfile: TUTOR_UML_PROFILE,
    umlKind: proposal.kind,
  });
  const start = Date.now();
  onStart();
  const image = await renderer.render(
    exportTutorUml(proposal),
    proposal.kind,
    signal,
  );
  signal?.throwIfAborted();
  const normalized = proposal;
  const diagram: TutorUmlDiagram = {
    version: 1,
    profile: TUTOR_UML_PROFILE,
    kind: proposal.kind,
    purpose: proposal.purpose,
    proposal: normalized,
  };
  const handle = artifacts.commit(reservation, diagram, image);
  bindings.set(handle, {
    question: context.question,
    fingerprint: canonicalDigest({
      ...context,
      profile: TUTOR_UML_PROFILE,
      rendererRevision: image.rendererRevision,
    }),
  });
  onCommit();
  if (scope?.closed) artifacts.release(handle);
  reportTutorDiagnostic({
    origin: "renderer",
    stage: "renderer",
    outcome: "rendered",
    graphicsProfile: TUTOR_UML_PROFILE,
    umlKind: proposal.kind,
    durationMs: Date.now() - start,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
  });
  report("provided", undefined, normalized);
  return { graphicStatus: "provided", diagram, _diagramArtifact: handle };
}
/** Optional preparation happens after the final question is selected and before the planning commit. */
export async function prepareTutorUml(
  provider: LLMProvider,
  context: UmlCodeContext,
  options: PreparationOptions,
): Promise<PreparedTutorUml> {
  const renderer = options.renderer ?? tutorUmlRenderer;
  const artifacts = options.artifacts ?? tutorUmlArtifacts;
  const scope = scopes.getStore();
  let reservation: TutorUmlReservation | null = null;
  let committed = false;
  let attempt = 0;
  let proposed = options.proposal;
  let normalizedCandidate = normalizedReviewCandidate(proposed);
  let rendering = false;
  const releaseReservation = () => {
    if (reservation) artifacts.release(reservation);
  };
  const report = (
    state: "provided" | "not-useful" | "unavailable" | "rejected",
    reason?: Parameters<typeof reportTutorDiagnostic>[0]["reason"],
    normalized: unknown = normalizedCandidate,
  ) => {
    reportTutorDiagnostic({
      origin: "service",
      stage: "content",
      outcome: state === "not-useful" ? "not-provided" : state,
      graphicsProfile: TUTOR_UML_PROFILE,
      graphicsMode: options.mode ?? "auto",
      graphicAttempt: attempt,
      ...(reason ? { reason } : {}),
    });
    reportTutorReview({
      kind: "uml",
      profile: TUTOR_UML_PROFILE,
      state,
      attempt,
      question: context.question,
      promptRevision: UML_PROMPT_REVISION,
      rendererRevision: UML_RENDERER_REVISION,
      ...(reason ? { reason } : {}),
      ...(normalized ? { proposalJson: JSON.stringify(normalized) } : {}),
    });
  };
  try {
    options.signal?.throwIfAborted();
    const primary =
      proposed === undefined
        ? undefined
        : validateTutorUmlProposal(proposed, context);
    const initial = initialDisposition(primary, options.mode, report);
    if (initial) return initial;
    if (!(await renderer.available())) {
      report("unavailable", "renderer-unavailable");
      return { graphicStatus: "unavailable" };
    }
    options.signal?.throwIfAborted();
    reservation = artifacts.reserve(scope?.owner, scope?.session);
    if (!reservation) {
      report("unavailable", "render-artifact-limit");
      return { graphicStatus: "unavailable" };
    }
    scope?.releases.push(releaseReservation);
    options.signal?.addEventListener("abort", releaseReservation, {
      once: true,
    });
    if (!primary?.ok) {
      if (!provider.generateGraphic) {
        report("unavailable", "provider-unavailable");
        return { graphicStatus: "unavailable" };
      }
      attempt = 1;
      beginTutorProviderAttempt();
      reportTutorModel(options.model);
      proposed = await generateProposal(
        provider.generateGraphic.bind(provider),
        context,
        options,
      );
      normalizedCandidate = normalizedReviewCandidate(proposed);
    }
    const checked = validateTutorUmlProposal(proposed, context);
    if (!checked.ok) {
      report("rejected", checked.reason);
      return { graphicStatus: "unavailable" };
    }
    if (checked.proposal.status === "not-useful") {
      report("not-useful", checked.proposal.reason, checked.proposal);
      return { graphicStatus: "not-useful" };
    }
    return await renderPreparedUml(checked.proposal, context, {
      renderer,
      artifacts,
      reservation,
      scope,
      signal: options.signal,
      report,
      onStart: () => {
        rendering = true;
      },
      onCommit: () => {
        committed = true;
      },
    });
  } catch (error) {
    return preparationFailed(error, rendering, options.signal, report);
  } finally {
    options.signal?.removeEventListener("abort", releaseReservation);
    if (reservation && !committed) artifacts.release(reservation);
  }
}
/** Expands only the response copy. Images never enter support caches, logs, or review collectors. */
export function serializeTutorDiagram<T>(
  body: T,
  owner: string | undefined,
  artifacts = tutorUmlArtifacts,
): T {
  if (body === null || typeof body !== "object") return body;
  const value = body as Record<string, unknown>;
  const { _diagramArtifact: handle, ...copy } = value;
  if (handle) {
    const artifact = artifacts.wireDiagram(
      handle as TutorUmlArtifactHandle,
      owner,
    );
    const binding = bindings.get(handle as TutorUmlArtifactHandle);
    if (
      artifact &&
      (!binding ||
        copy.question === undefined ||
        copy.question === binding.question)
    )
      copy.diagram = { ...artifact.metadata, image: artifact.image };
    else {
      delete copy.diagram;
      copy.graphicStatus = "unavailable";
    }
  } else if (copy.diagram) {
    delete copy.diagram;
    copy.graphicStatus = "unavailable";
  }
  if (copy.next && typeof copy.next === "object")
    copy.next = serializeTutorDiagram(copy.next, owner, artifacts);
  return copy as T;
}
function references(refs: SupportArtifactReferences): TutorUmlArtifactHandle[] {
  const handles: TutorUmlArtifactHandle[] = refs.question?.diagramArtifact
    ? [refs.question.diagramArtifact]
    : [];
  for (const body of refs.bodies) {
    if (body && typeof body === "object") {
      const value = body as Record<string, unknown>;
      if (value._diagramArtifact)
        handles.push(value._diagramArtifact as TutorUmlArtifactHandle);
      const next = value.next as Record<string, unknown> | undefined;
      if (next?._diagramArtifact)
        handles.push(next._diagramArtifact as TutorUmlArtifactHandle);
    }
  }
  return handles;
}
export const tutorUmlSupportLifecycle: TutorSupportLifecycleHooks = {
  deliveryRequested: (owner, session) => {
    // Pending duplicates execute in the first caller's ALS context: capture each caller here.
    const scope = scopes.getStore();
    if (scope?.owner !== owner || scope.session !== session)
      return undefined;
    return (body) => {
      const release = tutorUmlArtifacts.pinDelivery(
        owner, session, references({ question: null, bodies: [body] }),
      );
      if (scope.closed) release();
      else scope.releases.push(release);
    };
  },
  referencesChanged: (owner, session, refs) =>
    tutorUmlArtifacts.reconcileSession(owner, session, references(refs)),
  removed: (owner, session) =>
    tutorUmlArtifacts.reconcileSession(owner, session, []),
  discarded: (_owner, _session, refs) => {
    for (const handle of references(refs)) tutorUmlArtifacts.release(handle);
  },
};
export function withoutTutorGraphics(
  result: TutorContentResult,
): TutorContentResult {
  const {
    mermaid: _mermaid,
    graphicStatus: _graphicStatus,
    diagram: _diagram,
    ...text
  } = result;
  return text;
}

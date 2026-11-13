import { TUTOR_UML_LIMITS } from "@shared/tutor-uml-profile";
import { UML_RENDER_LIMITS, UmlRenderError } from "./limits";
import type { RenderedUmlImage } from "./svg";

declare const reservationBrand: unique symbol;
declare const artifactBrand: unique symbol;
/** Opaque server-only references. Neither token contains image data or a public identifier. */
export type TutorUmlReservation = { readonly [reservationBrand]: true };
export type TutorUmlArtifactHandle = { readonly [artifactBrand]: true };
export interface TutorUmlWireDiagram<T> {
  readonly metadata: T;
  readonly image: RenderedUmlImage;
}
type Token = TutorUmlReservation | TutorUmlArtifactHandle;
type StoredArtifact = {
  readonly metadata: string;
  readonly image: RenderedUmlImage;
};
type Entry = {
  readonly owner: string | undefined;
  readonly reservedSession: string | undefined;
  bytes: number;
  request: boolean;
  readonly sessions: Set<string>;
  readonly deliveries: Map<string, number>;
  artifact?: StoredArtifact;
};
// The checked 16 KiB proposal plus app-owned binding/profile/purpose fields fit this separate envelope.
const METADATA_BYTES = 32 * 1024;
const RESERVED_BYTES = TUTOR_UML_LIMITS.imageBytes + METADATA_BYTES;
const limit = (): never => {
  throw new UmlRenderError("render-artifact-limit");
};

/** Payload budgets count canonical SVG plus serialized metadata once, regardless of replay count. */
export class TutorUmlArtifacts<T = unknown> {
  private readonly entries = new Map<Token, Entry>();
  private readonly sessions = new Map<
    string | undefined,
    Map<string, Set<TutorUmlArtifactHandle>>
  >();

  /** Must precede optional model/render work. Full budgets never evict an existing replay. */
  reserve(
    owner: string | undefined,
    session?: string,
  ): TutorUmlReservation | null {
    if (owner === undefined) session = undefined;
    let global = 0;
    let own = 0;
    let inSession = 0;
    for (const entry of this.entries.values()) {
      global += entry.bytes;
      if (entry.owner !== owner) continue;
      own += entry.bytes;
      if (session !== undefined && this.belongsTo(entry, session))
        inSession += entry.bytes;
    }
    if (
      global + RESERVED_BYTES > UML_RENDER_LIMITS.globalArtifactBytes ||
      (owner !== undefined &&
        own + RESERVED_BYTES > UML_RENDER_LIMITS.ownerArtifactBytes) ||
      (session !== undefined &&
        inSession + RESERVED_BYTES > UML_RENDER_LIMITS.sessionArtifactBytes)
    )
      return null;
    const token = Object.freeze({}) as TutorUmlReservation;
    this.entries.set(token, {
      owner,
      reservedSession: session,
      bytes: RESERVED_BYTES,
      request: true,
      sessions: new Set(),
      deliveries: new Map(),
    });
    return token;
  }

  /** Consumes the reservation; release(reservation) also works after commit for abort/finally cleanup. */
  commit(
    reservation: TutorUmlReservation,
    metadata: T,
    image: RenderedUmlImage,
  ): TutorUmlArtifactHandle {
    const entry = this.entries.get(reservation);
    if (!entry || entry.artifact) return limit();
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(metadata);
    } catch {
      return limit();
    }
    if (serialized === undefined) return limit();
    const bytes = Buffer.byteLength(image.svg);
    const header = {
      width: image.width,
      height: image.height,
      bytes,
      rendererRevision: image.rendererRevision,
    };
    const metadataBytes =
      Buffer.byteLength(serialized) + Buffer.byteLength(JSON.stringify(header));
    if (metadataBytes > METADATA_BYTES || bytes > TUTOR_UML_LIMITS.imageBytes)
      return limit();
    entry.bytes = bytes + metadataBytes;
    entry.artifact = {
      metadata: serialized,
      image: { svg: image.svg, ...header },
    };
    return reservation as unknown as TutorUmlArtifactHandle;
  }

  /** Drops the generation pin. Session/replay and delivery holds remain valid. Idempotent. */
  release(token: Token): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    entry.request = false;
    this.deleteUnreferenced(token, entry);
  }

  /** Each admitted response owns a separate hold, associated with its support session. */
  pinDelivery(
    owner: string,
    session: string,
    handles: readonly TutorUmlArtifactHandle[],
  ): () => void {
    const unique = new Set(handles);
    // Validate the entire set before adding any hold.
    for (const handle of unique) {
      const entry = this.entries.get(handle);
      if (
        !entry?.artifact ||
        entry.owner !== owner ||
        !this.belongsTo(entry, session)
      ) return limit();
    }
    for (const handle of unique) {
      const entry = this.entries.get(handle)!;
      entry.deliveries.set(session, (entry.deliveries.get(session) ?? 0) + 1);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.unpinDelivery(session, unique);
    };
  }

  private unpinDelivery(session: string, handles: ReadonlySet<TutorUmlArtifactHandle>): void {
    for (const handle of handles) {
      const entry = this.entries.get(handle)!;
      const remaining = entry.deliveries.get(session)! - 1;
      if (remaining > 0) entry.deliveries.set(session, remaining);
      else entry.deliveries.delete(session);
      this.deleteUnreferenced(handle, entry);
    }
  }

  private deleteUnreferenced(token: Token, entry: Entry): void {
    if (
      !entry.request && entry.sessions.size === 0 && entry.deliveries.size === 0
    ) this.entries.delete(token);
  }

  /** All validation precedes mutation, including request-local adoption into a just-opened session. */
  reconcileSession(
    owner: string | undefined,
    session: string,
    handles: readonly TutorUmlArtifactHandle[],
  ): void {
    const next = new Set(handles);
    if (owner === undefined && next.size > 0) return limit();
    if (
      this.reconciledBytes(owner, session, next) >
      UML_RENDER_LIMITS.sessionArtifactBytes
    )
      return limit();
    this.updateSessionPins(owner, session, next);
  }

  private reconciledBytes(
    owner: string | undefined,
    session: string,
    next: ReadonlySet<TutorUmlArtifactHandle>,
  ): number {
    let bytes = 0;
    for (const handle of next) {
      const entry = this.entries.get(handle);
      if (!entry?.artifact || entry.owner !== owner) return limit();
      bytes += entry.bytes;
    }
    // Reservations and admitted deliveries remain charged even when logical refs change.
    for (const [token, entry] of this.entries) {
      if (
        entry.owner === owner &&
        ((entry.request && entry.reservedSession === session) ||
          entry.deliveries.has(session)) &&
        !next.has(token as TutorUmlArtifactHandle)
      )
        bytes += entry.bytes;
    }
    return bytes;
  }

  private updateSessionPins(
    owner: string | undefined,
    session: string,
    next: Set<TutorUmlArtifactHandle>,
  ): void {
    const own =
      this.sessions.get(owner) ??
      new Map<string, Set<TutorUmlArtifactHandle>>();
    const previous = own.get(session) ?? new Set<TutorUmlArtifactHandle>();
    for (const handle of next) {
      const entry = this.entries.get(handle)!;
      entry.sessions.add(session);
      entry.request = false;
    }
    for (const handle of previous) {
      if (next.has(handle)) continue;
      const entry = this.entries.get(handle)!;
      entry.sessions.delete(session);
      this.deleteUnreferenced(handle, entry);
    }
    if (next.size > 0) {
      own.set(session, next);
      this.sessions.set(owner, own);
    } else {
      own.delete(session);
      if (own.size === 0) this.sessions.delete(owner);
    }
  }

  /** Creates a response value on demand; replay caches retain only the opaque handle. */
  wireDiagram(
    handle: TutorUmlArtifactHandle,
    owner: string | undefined,
  ): TutorUmlWireDiagram<T> | null {
    const entry = this.entries.get(handle);
    if (!entry?.artifact || entry.owner !== owner) return null;
    return {
      metadata: JSON.parse(entry.artifact.metadata) as T,
      image: { ...entry.artifact.image },
    };
  }

  private belongsTo(entry: Entry, session: string): boolean {
    return (
      entry.sessions.has(session) ||
      entry.deliveries.has(session) ||
      (entry.request && entry.reservedSession === session)
    );
  }
}

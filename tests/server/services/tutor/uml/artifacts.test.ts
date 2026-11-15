import { describe, expect, it } from "vitest";
import {
  TutorUmlArtifacts,
  type TutorUmlArtifactHandle,
} from "../../../../../server/services/tutor/uml/artifacts";
import type { RenderedUmlImage } from "../../../../../server/services/tutor/uml/svg";

const KiB = 1024;
const maxArtifact = 544 * KiB;
function image(bytes = 10): RenderedUmlImage {
  return {
    svg: "x".repeat(bytes),
    bytes,
    width: 100,
    height: 100,
    rendererRevision: "test",
  };
}
function put(
  store: TutorUmlArtifacts<unknown>,
  owner: string | undefined,
  session?: string,
  bytes = 100,
): TutorUmlArtifactHandle {
  const reservation = store.reserve(owner, session);
  expect(reservation).not.toBeNull();
  const rendered = image(Math.min(bytes - 80, 512 * KiB));
  // Hand-written fixture encoding counts all image headers independently of the store's serializer.
  const header = `{"width":100,"height":100,"bytes":${rendered.bytes},"rendererRevision":"test"}`;
  const metadataBytes = bytes - rendered.bytes - Buffer.byteLength(header);
  return store.commit(reservation!, "m".repeat(metadataBytes - 2), rendered);
}

describe("Tutor UML artifact admission and canonical storage", () => {
  it("reserves the maximum image and metadata before optional work and releases cancelled requests", () => {
    const store = new TutorUmlArtifacts();
    const reservations = Array.from({ length: 7 }, () =>
      store.reserve("alice", "session"),
    );
    expect(reservations.every(Boolean)).toBe(true);
    expect(store.reserve("alice", "session")).toBeNull();
    store.release(reservations[0]!);
    expect(store.reserve("alice", "session")).not.toBeNull();
  });

  it.each([
    { scope: "session", budget: 4 * 1024 * KiB },
    { scope: "owner", budget: 8 * 1024 * KiB },
    { scope: "global", budget: 64 * 1024 * KiB },
  ])(
    "admits exactly the $scope budget and denies one byte above it without evicting replays",
    ({ scope, budget }) => {
      const store = new TutorUmlArtifacts();
      const handles: TutorUmlArtifactHandle[] = [];
      let occupied = 0;
      let index = 0;
      const owner = () => (scope === "global" ? `owner-${index}` : "alice");
      const session = () => (scope === "session" ? "session" : undefined);
      // Keep room for a maximum reservation, then consume precisely the remaining bytes.
      while (budget - occupied > maxArtifact) {
        const bytes = Math.min(maxArtifact, budget - occupied - maxArtifact);
        handles.push(put(store, owner(), session(), bytes));
        occupied += bytes;
        index++;
      }
      const reservation = store.reserve(owner(), session());
      expect(reservation).not.toBeNull();
      // Image headers take 67 bytes; the JSON string plus headers consumes exactly 32 KiB.
      handles.push(
        store.commit(reservation!, "m".repeat(32699), image(512 * KiB)),
      );
      expect(store.reserve(owner(), session())).toBeNull();
      expect(
        store.wireDiagram(handles[0], scope === "global" ? "owner-0" : "alice"),
      ).not.toBeNull();
      store.release(handles[0]);
      expect(store.reserve(owner(), session())).not.toBeNull();

      const oneByteOver = new TutorUmlArtifacts();
      const target = budget - maxArtifact + 1;
      let used = 0;
      let subject = 0;
      while (used < target) {
        const bytes = Math.min(maxArtifact, target - used);
        put(
          oneByteOver,
          scope === "global" ? `subject-${subject++}` : "alice",
          session(),
          bytes,
        );
        used += bytes;
      }
      expect(
        oneByteOver.reserve(
          scope === "global" ? "new-subject" : "alice",
          session(),
        ),
      ).toBeNull();
    },
  );

  it("counts UTF-8 SVG plus serialized metadata, shrinks reservations and copies only on wire access", () => {
    const store = new TutorUmlArtifacts<{ label: string }>();
    const metadata = { label: "ä" };
    const rendered = image();
    const reservation = store.reserve("alice", "one")!;
    const handle = store.commit(reservation, metadata, rendered);
    metadata.label = "changed";
    expect(store.wireDiagram(handle, "alice")).toEqual({
      metadata: { label: "ä" },
      image: rendered,
    });
    expect(store.wireDiagram(handle, "bob")).toBeNull();
    expect(store.wireDiagram(handle, undefined)).toBeNull();
    const wire = store.wireDiagram(handle, "alice")!;
    wire.metadata.label = "mutated output";
    expect(store.wireDiagram(handle, "alice")?.metadata.label).toBe("ä");
    expect(store.reserve("alice", "one")).not.toBeNull();
  });

  it("does not trust reported image bytes and allows cleanup after rejecting oversized metadata", () => {
    const store = new TutorUmlArtifacts();
    const reservation = store.reserve("alice", "one")!;
    expect(() =>
      store.commit(reservation, null, { ...image(512 * KiB + 1), bytes: 1 }),
    ).toThrow("render-artifact-limit");
    store.release(reservation);
    const next = store.reserve("alice", "one")!;
    expect(() => store.commit(next, "ä".repeat(16384), image())).toThrow(
      "render-artifact-limit",
    );
    store.release(next);
    expect(store.reserve("alice", "one")).not.toBeNull();
  });

  it("includes every serialized image header in the metadata envelope", () => {
    const store = new TutorUmlArtifacts();
    const reservation = store.reserve("alice")!;
    expect(() =>
      store.commit(reservation, null, {
        ...image(),
        rendererRevision: "r".repeat(32 * KiB),
      }),
    ).toThrow("render-artifact-limit");
    store.release(reservation);
  });

  it("keeps one canonical artifact across duplicate replay refs and multiple sessions until the last ref ends", () => {
    const store = new TutorUmlArtifacts();
    const handle = put(store, "alice", undefined, maxArtifact);
    store.reconcileSession(
      "alice",
      "one",
      Array.from({ length: 100 }, () => handle),
    );
    store.reconcileSession("alice", "two", [handle]);
    store.release(handle);
    store.reconcileSession("alice", "one", []);
    expect(store.wireDiagram(handle, "alice")).not.toBeNull();
    store.reconcileSession("alice", "two", []);
    expect(store.wireDiagram(handle, "alice")).toBeNull();
    store.release(handle);
  });

  it("transfers request-local artifacts atomically and refuses foreign or oversized session adoption", () => {
    const store = new TutorUmlArtifacts();
    const handle = put(store, "alice");
    expect(() => store.reconcileSession("bob", "stolen", [handle])).toThrow(
      "render-artifact-limit",
    );
    expect(store.wireDiagram(handle, "alice")).not.toBeNull();
    store.reconcileSession("alice", "new", [handle]);
    store.release(handle);
    expect(store.wireDiagram(handle, "alice")).not.toBeNull();
    const others = Array.from({ length: 8 }, () =>
      put(store, "alice", undefined, maxArtifact),
    );
    expect(() =>
      store.reconcileSession("alice", "new", [handle, ...others]),
    ).toThrow("render-artifact-limit");
    expect(store.wireDiagram(handle, "alice")).not.toBeNull();
    for (const other of others) store.release(other);
    store.reconcileSession("alice", "new", []);
    expect(store.wireDiagram(handle, "alice")).toBeNull();
  });

  it("keeps anonymous artifacts request-local and gives aborted commits no durable lifetime", () => {
    const store = new TutorUmlArtifacts();
    const anonymousRequests = Array.from({ length: 16 }, () =>
      store.reserve(undefined, "untrusted-session"),
    );
    expect(anonymousRequests.every(Boolean)).toBe(true);
    for (const anonymous of anonymousRequests) store.release(anonymous!);
    const reservation = store.reserve(undefined)!;
    const handle = store.commit(reservation, null, image());
    expect(store.wireDiagram(handle, undefined)).not.toBeNull();
    expect(store.wireDiagram(handle, "alice")).toBeNull();
    expect(() =>
      store.reconcileSession(undefined, "anonymous", [handle]),
    ).toThrow("render-artifact-limit");
    store.release(reservation);
    expect(store.wireDiagram(handle, undefined)).toBeNull();
    expect(() => store.commit(reservation, null, image())).toThrow(
      "render-artifact-limit",
    );
  });
});

it("charges detached delivery holds once per session and owner until the last independent release", () => {
  const store = new TutorUmlArtifacts();
  const handles = Array.from({ length: 7 }, () => put(store, "alice", "one", maxArtifact));
  store.reconcileSession("alice", "one", handles);
  const first = store.pinDelivery("alice", "one", [...handles, ...handles]);
  const second = store.pinDelivery("alice", "one", handles);
  store.reconcileSession("alice", "one", []);
  expect(store.reserve("alice", "one")).toBeNull();
  const other = Array.from({ length: 7 }, () => put(store, "alice", "two", maxArtifact));
  other.push(put(store, "alice", "three", maxArtifact));
  expect(store.reserve("alice", "three")).toBeNull();
  expect(() => store.reconcileSession("alice", "one", [other[0]])).toThrow("render-artifact-limit");
  first(); first();
  expect(store.reserve("alice", "one")).toBeNull();
  expect(store.wireDiagram(handles[0], "alice")).not.toBeNull();
  second();
  for (const handle of handles) expect(store.wireDiagram(handle, "alice")).toBeNull();
  const reservation = store.reserve("alice", "one");
  expect(reservation).not.toBeNull();
  store.release(reservation!);
  for (const handle of other) store.release(handle);
});

it("rejects foreign or unrelated-session deliveries atomically without creating leaked partial holds", () => {
  const store = new TutorUmlArtifacts();
  const alice = put(store, "alice", "one");
  const bob = put(store, "bob", "one");
  store.reconcileSession("alice", "one", [alice]);
  store.reconcileSession("bob", "one", [bob]);
  expect(() => store.pinDelivery("alice", "one", [alice, bob])).toThrow("render-artifact-limit");
  expect(() => store.pinDelivery("alice", "wrong-session", [alice])).toThrow("render-artifact-limit");
  store.reconcileSession("alice", "one", []);
  expect(store.wireDiagram(alice, "alice")).toBeNull();
  expect(store.wireDiagram(bob, "bob")).not.toBeNull();
  store.reconcileSession("bob", "one", []);
});

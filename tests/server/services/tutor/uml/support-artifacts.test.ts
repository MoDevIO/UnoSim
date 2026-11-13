import { describe, expect, it } from "vitest";
import {
  newSupportQuestion,
  resetSupportQuestion,
  withQuestionGraphic,
  TutorSupportStore,
  type SupportQuestion,
} from "../../../../../server/services/tutor/learning-support-store";
import {
  TutorUmlArtifacts,
  type TutorUmlArtifactHandle,
} from "../../../../../server/services/tutor/uml/artifacts";

const limits = { ttlMs: 100, maxSessions: 10, maxSessionsPerSubject: 5 };
type WithArtifact = { artifact?: TutorUmlArtifactHandle };
function fixture(storeLimits = limits) {
  let now = 0;
  const artifacts = new TutorUmlArtifacts();
  const handles = (values: readonly unknown[]) =>
    values.flatMap((value) => {
      const handle = (value as WithArtifact | null)?.artifact;
      return handle ? [handle] : [];
    });
  const store = new TutorSupportStore(storeLimits, () => now, {
    referencesChanged(owner, session, state) {
      artifacts.reconcileSession(
        owner,
        session,
        handles([state.question, ...state.bodies]),
      );
    },
    removed(owner, session) {
      artifacts.reconcileSession(owner, session, []);
    },
    discarded(_owner, _session, state) {
      for (const handle of handles([state.question, ...state.bodies]))
        artifacts.release(handle);
    },
  });
  function graphic(owner = "alice") {
    return artifacts.commit(
      artifacts.reserve(owner)!,
      { kind: "activity" },
      {
        svg: "<svg/>",
        bytes: 6,
        width: 100,
        height: 100,
        rendererRevision: "test",
      },
    );
  }
  function question(
    artifact: TutorUmlArtifactHandle,
  ): SupportQuestion & WithArtifact {
    return { ...newSupportQuestion("What happens?", "context"), artifact };
  }
  return {
    store,
    artifacts,
    graphic,
    question,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("support-session artifact lifetimes", () => {
  it("adopts a request-local question atomically and expires only the owning session's refs", () => {
    const f = fixture();
    const first = f.graphic();
    const second = f.graphic();
    const one = f.store.open("alice", f.question(first));
    f.artifacts.release(first);
    f.advance(50);
    const two = f.store.open("alice", f.question(second));
    f.artifacts.release(second);
    f.advance(50);
    expect(f.store.view("alice", one)).toBeNull();
    expect(f.artifacts.wireDiagram(first, "alice")).toBeNull();
    expect(f.store.view("alice", two)).not.toBeNull();
    expect(f.artifacts.wireDiagram(second, "alice")).not.toBeNull();
    expect(f.store.view("bob", two)).toBeNull();
  });

  it("keeps a replaced question through its last replay and releases it on the 32-result eviction", async () => {
    const f = fixture();
    const artifact = f.graphic();
    const session = f.store.open("alice", f.question(artifact));
    const response = { artifact, text: "stored" };
    expect(
      await f.store.run("alice", session, "first", "fp", async () => ({
        body: response,
        update: { question: null },
      })),
    ).toEqual({ status: "ok", body: response });
    f.artifacts.release(artifact);
    let replayCalls = 0;
    expect(
      await f.store.run("alice", session, "first", "fp", async () => {
        replayCalls++;
        throw new Error("replay ran");
      }),
    ).toEqual({ status: "ok", body: response });
    expect(replayCalls).toBe(0);
    for (let index = 0; index < 31; index++) {
      await f.store.run("alice", session, `next-${index}`, "fp", async () => ({
        body: { text: "next" },
        update: {},
      }));
    }
    expect(f.artifacts.wireDiagram(artifact, "alice")).not.toBeNull();
    await f.store.run("alice", session, "last", "fp", async () => ({
      body: {},
      update: {},
    }));
    expect(f.artifacts.wireDiagram(artifact, "alice")).toBeNull();
    expect(
      await f.store.run("alice", session, "first", "fp", async () => {
        throw new Error("spent ran");
      }),
    ).toEqual({ status: "spent" });
  });

  it("keeps a current question even after its first replay is evicted", async () => {
    const f = fixture();
    const artifact = f.graphic();
    const session = f.store.open("alice", f.question(artifact));
    for (let index = 0; index < 33; index++)
      await f.store.run("alice", session, `id-${index}`, "fp", async () => ({
        body: {},
        update: {},
      }));
    expect(f.artifacts.wireDiagram(artifact, "alice")).not.toBeNull();
    f.advance(100);
    f.store.stats();
    expect(f.artifacts.wireDiagram(artifact, "alice")).toBeNull();
  });

  it("releases only the last reference when per-owner or global capacity removes sessions", () => {
    const f = fixture({ ...limits, maxSessions: 2, maxSessionsPerSubject: 1 });
    const shared = f.graphic();
    const old = f.store.open("alice", f.question(shared));
    const replacement = f.store.open("alice", f.question(shared));
    // Capacity removes the old session before adopting the replacement: keep the request pin until open.
    expect(f.store.view("alice", old)).toBeNull();
    expect(f.store.view("alice", replacement)).not.toBeNull();
    expect(f.artifacts.wireDiagram(shared, "alice")).not.toBeNull();
    const bob = f.graphic("bob");
    f.store.open("bob", f.question(bob));
    const carol = f.graphic("carol");
    f.store.open("carol", f.question(carol));
    expect(f.artifacts.wireDiagram(shared, "alice")).toBeNull();
    expect(f.artifacts.wireDiagram(bob, "bob")).not.toBeNull();
  });

  it("keeps learning state, replay history and artifact refs unchanged when reconciliation throws", async () => {
    const f = fixture();
    const oldQuestionArtifact = f.graphic();
    const original = f.question(oldQuestionArtifact);
    const session = f.store.open("alice", original);
    const oldReplayArtifact = f.graphic();
    const oldBody = { artifact: oldReplayArtifact, text: "old result" };
    await f.store.run("alice", session, "oldest", "old", async () => ({
      body: oldBody,
      update: {},
    }));
    for (let index = 0; index < 31; index++) {
      await f.store.run("alice", session, `fill-${index}`, "fp", async () => ({
        body: {},
        update: {},
      }));
    }
    const unadopted = f.graphic();
    const foreign = f.graphic("bob");
    const prospective = {
      ...original,
      text: "replacement",
      answerAttempts: 1,
      clarifications: 1,
      clarificationTexts: ["new explanation"],
      artifact: unadopted,
    };
    // Real pool reconciliation rejects the foreign token before changing its reference sets.
    await expect(
      f.store.run("alice", session, "rejected", "first-attempt", async () => ({
        body: { artifact: foreign },
        update: { question: prospective, skippedQuestion: original.text },
      })),
    ).rejects.toThrow("render-artifact-limit");
    f.artifacts.release(unadopted);
    f.artifacts.release(foreign);

    expect(f.store.view("alice", session)).toMatchObject({
      question: original,
      skippedQuestions: [],
    });
    expect(f.store.view("alice", session)?.question).toBe(original);
    expect(
      f.artifacts.wireDiagram(oldQuestionArtifact, "alice"),
    ).not.toBeNull();
    expect(f.artifacts.wireDiagram(oldReplayArtifact, "alice")).not.toBeNull();
    expect(f.artifacts.wireDiagram(unadopted, "alice")).toBeNull();
    expect(
      await f.store.run("alice", session, "oldest", "old", async () => {
        throw new Error("old replay was evicted");
      }),
    ).toEqual({ status: "ok", body: oldBody });

    const retryArtifact = f.graphic();
    let retryCalls = 0;
    const retry = async () => {
      retryCalls++;
      return {
        body: { artifact: retryArtifact },
        update: {
          question: { ...prospective, artifact: retryArtifact },
          skippedQuestion: original.text,
        },
      };
    };
    // A rejected action has neither a cached result/conflict nor a spent id, even with a new fingerprint.
    expect(
      await f.store.run(
        "alice",
        session,
        "rejected",
        "corrected-attempt",
        retry,
      ),
    ).toEqual({ status: "ok", body: { artifact: retryArtifact } });
    expect(
      await f.store.run(
        "alice",
        session,
        "rejected",
        "corrected-attempt",
        retry,
      ),
    ).toEqual({ status: "ok", body: { artifact: retryArtifact } });
    expect(retryCalls).toBe(1);
    expect(f.store.view("alice", session)).toMatchObject({
      question: { text: "replacement", answerAttempts: 1, clarifications: 1 },
      skippedQuestions: [original.text],
    });
    expect(f.artifacts.wireDiagram(oldQuestionArtifact, "alice")).toBeNull();
    expect(f.artifacts.wireDiagram(oldReplayArtifact, "alice")).toBeNull();
    expect(f.artifacts.wireDiagram(retryArtifact, "alice")).not.toBeNull();
  });

  it("discards a newly rendered result when its session expires during the action", async () => {
    const f = fixture();
    const old = f.graphic();
    const session = f.store.open("alice", f.question(old));
    let rendered: TutorUmlArtifactHandle | undefined;
    const outcome = await f.store.run(
      "alice",
      session,
      "slow",
      "fp",
      async () => {
        rendered = f.graphic();
        f.advance(100);
        return {
          body: { artifact: rendered },
          update: { question: f.question(rendered) },
        };
      },
    );
    expect(outcome).toEqual({ status: "missing" });
    expect(f.artifacts.wireDiagram(old, "alice")).toBeNull();
    expect(f.artifacts.wireDiagram(rendered!, "alice")).toBeNull();
  });
});

// The support state keeps the private token beside its public diagram metadata; it never holds SVGs.
describe("support question diagram tokens", () => {
  it("remembers only explicitly supplied diagram tokens and clears them on replacement or context reset", () => {
    const artifacts = new TutorUmlArtifacts();
    const token = artifacts.commit(artifacts.reserve("alice")!, null, {
      svg: "<svg/>",
      bytes: 6,
      width: 1,
      height: 1,
      rendererRevision: "test",
    });
    const graphic = {
      graphicStatus: "provided" as const,
      diagram: {
        version: 1 as const,
        profile: "uml1-classic-v1" as const,
        kind: "activity" as const,
        purpose: "Shows the call",
        proposal: {
          version: 1 as const,
          profile: "uml1-classic-v1" as const,
          status: "diagram" as const,
          kind: "activity" as const,
          purpose: "Shows the call",
          scope: { file: "sketch.ino", startLine: 1, endLine: 1 },
          body: [
            {
              type: "action" as const,
              code: "run();",
              ref: { file: "sketch.ino", startLine: 1, endLine: 1 },
            },
          ],
        },
      },
    };
    const question = newSupportQuestion("Question", "ctx", graphic, token);
    expect(question.diagramArtifact).toBe(token);
    expect(question.graphic?.diagram).toEqual(graphic.diagram);
    expect(withQuestionGraphic(question, graphic, token).diagramArtifact).toBe(
      token,
    );
    const cleared = withQuestionGraphic(question, {
      graphicStatus: "unavailable",
    });
    expect(cleared).not.toHaveProperty("diagramArtifact");
    expect(resetSupportQuestion(question, "new")).not.toHaveProperty(
      "diagramArtifact",
    );
    expect(newSupportQuestion("plain", "ctx")).not.toHaveProperty(
      "diagramArtifact",
    );
    expect(
      newSupportQuestion("plain", "ctx", undefined, token),
    ).not.toHaveProperty("diagramArtifact");
  });
});

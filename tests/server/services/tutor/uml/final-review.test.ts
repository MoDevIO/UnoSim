import { afterEach, expect, it } from "vitest";
import type { TutorUmlDiagram } from "@shared/tutor-uml";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { newSupportQuestion, TutorSupportStore } from "../../../../../server/services/tutor/learning-support-store";
import { enterTutorUmlArtifacts, serializeTutorDiagram, tutorUmlArtifacts, tutorUmlSupportLifecycle } from "../../../../../server/services/tutor/uml/service";
import { activity, context, ref } from "./contract-fixtures";

function memberSequence(initializer: string) {
  const call = initializer ? "sensor.read()" : "sensor.read(2)";
  const code = `int measure() { return 2; }\nclass Sensor { public: int read(int value${initializer}) { return 1; } };\nSensor sensor;\nvoid run() {\n  ${call};\n}`;
  const proposal = {
    version: 1, profile: "uml1-classic-v1", status: "diagram", kind: "sequence",
    purpose: "Die Aufrufe von run an sensor in ihrer Reihenfolge verfolgen.", scope: ref(4, 6),
    participants: [{ kind: "context", name: "run", ref: ref(4, 6) }, { kind: "object", name: "sensor", className: "Sensor", ref: ref(3) }],
    messages: [{ type: "call", from: "run", to: "sensor", code: call, ref: ref(5) }, { type: "return", from: "sensor", to: "run", code: "return 1;", ref: ref(2) }],
  };
  return { code, proposal };
}
it("rejects the final-review member call with an omitted executable default argument", () => {
  const { code, proposal } = memberSequence(" = measure()");
  expect(validateTutorUmlProposal(proposal, context(code, "Welche Aufrufe werden beim Aufruf von run ausgeführt?"))).toEqual({ ok: false, reason: "invalid-evidence" });
});
it("rejects an executable default on the selected entry function", () => {
  const { code, proposal } = memberSequence(" = 2");
  expect(validateTutorUmlProposal(proposal, context(code.replace("void run()", "void run(int value = measure())"), "Welche Aufrufe werden beim Aufruf von run ausgeführt?"))).toEqual({ ok: false, reason: "invalid-evidence" });
});
it("rejects an executable default supplied by a separate free-function declaration", () => {
  const code = `int measure() { return 2; }\nint read(int value = measure());\nint read(int value) { return 1; }\nvoid run() {\n  read();\n}`;
  const proposal = {
    ...memberSequence("").proposal,
    participants: [{ kind: "context", name: "run", ref: ref(4, 6) }, { kind: "context", name: "read", ref: ref(3) }],
    messages: [{ type: "call", from: "run", to: "read", code: "read()", ref: ref(5) }, { type: "return", from: "read", to: "run", code: "return 1;", ref: ref(3) }],
  };
  expect(validateTutorUmlProposal(proposal, context(code, "Welche Aufrufe werden beim Aufruf von run ausgeführt?"))).toEqual({ ok: false, reason: "invalid-evidence" });
});
it.each(["", " = 2", " = true", " = 'a'"])("keeps ordinary member calls and non-executable defaults: %s", initializer => {
  const { code, proposal } = memberSequence(initializer);
  expect(validateTutorUmlProposal(proposal, context(code, "Welche Aufrufe werden beim Aufruf von run ausgeführt?")).ok).toBe(true);
});

it("keeps a no-call default supplied by a separate free-function declaration", () => {
  const code = `int read(int value = 2);\nint read(int value) { return 1; }\nvoid run() {\n  read();\n}`;
  const proposal = {
    ...memberSequence("").proposal,
    scope: ref(3, 5),
    participants: [{ kind: "context", name: "run", ref: ref(3, 5) }, { kind: "context", name: "read", ref: ref(2) }],
    messages: [{ type: "call", from: "run", to: "read", code: "read()", ref: ref(4) }, { type: "return", from: "read", to: "run", code: "return 1;", ref: ref(2) }],
  };
  expect(validateTutorUmlProposal(proposal, context(code, "Welche Aufrufe werden beim Aufruf von run ausgeführt?")).ok).toBe(true);
});

const cleanups: Array<() => void> = [];
afterEach(() => { for (const release of cleanups.splice(0)) release(); });
function request<T>(owner: string, session: string, run: () => Promise<T>) {
  let result!: Promise<T>;
  const release = enterTutorUmlArtifacts(owner, session, () => { result = run(); });
  cleanups.push(release);
  return { result, release };
}
function deliveryFixture() {
  let now = 0;
  const owner = `delivery-${crypto.randomUUID()}`;
  const store = new TutorSupportStore({ ttlMs: 100, maxSessions: 10, maxSessionsPerSubject: 1 }, () => now, tutorUmlSupportLifecycle);
  const session = store.open(owner, newSupportQuestion("Question", "context"));
  cleanups.push(() => { now += 100; store.stats(); });
  const diagram = { version: 1, profile: "uml1-classic-v1", kind: "activity", purpose: activity.purpose, proposal: activity } as TutorUmlDiagram;
  const artifact = tutorUmlArtifacts.commit(tutorUmlArtifacts.reserve(owner, session)!, diagram, { svg: "<svg/>", bytes: 6, width: 1, height: 1, rendererRevision: "test" });
  cleanups.push(() => tutorUmlArtifacts.release(artifact));
  const body = { graphicStatus: "provided", _diagramArtifact: artifact };
  const noWork = async (): Promise<never> => { throw new Error("replay must not run model or renderer"); };
  const empty = async () => ({ body: {}, update: {} });
  return { owner, store, session, artifact, body, noWork, empty, expire: () => { now += 100; store.stats(); } };
}
it("pins the final-review cached replay before the concurrent 33rd result evicts it", async () => {
  const f = deliveryFixture();
  await f.store.run(f.owner, f.session, "first", "fp", async () => ({ body: f.body, update: {} }));
  tutorUmlArtifacts.release(f.artifact);
  for (let index = 0; index < 31; index++) await f.store.run(f.owner, f.session, `fill${index}`, "fp", f.empty);
  const advancing = f.store.run(f.owner, f.session, "last", "fp", f.empty);
  await Promise.resolve();
  const replay = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "first", "fp", f.noWork));
  const result = await replay.result;
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("missing replay");
  expect(serializeTutorDiagram(result.body, f.owner)).toMatchObject({ graphicStatus: "provided", diagram: { image: { svg: "<svg/>" } } });
  await advancing;
  expect(await f.store.run(f.owner, f.session, "first", "fp", f.noWork)).toEqual({ status: "spent" });
  replay.release();
  expect(tutorUmlArtifacts.wireDiagram(f.artifact, f.owner)).toBeNull();
});
it("gives two concurrent replays distinct delivery pins through session expiry and serialization", async () => {
  const f = deliveryFixture();
  await f.store.run(f.owner, f.session, "first", "fp", async () => ({ body: f.body, update: {} }));
  tutorUmlArtifacts.release(f.artifact);
  const one = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "first", "fp", f.noWork));
  const two = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "first", "fp", f.noWork));
  await Promise.all([one.result, two.result]);
  f.expire();
  one.release(); one.release();
  expect(serializeTutorDiagram(f.body, f.owner)).toHaveProperty("diagram.image.svg", "<svg/>");
  two.release();
  expect(tutorUmlArtifacts.wireDiagram(f.artifact, f.owner)).toBeNull();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
it.each(["current", "duplicate"])("pins current and pending-duplicate results independently when %s closes first", async closesFirst => {
  const f = deliveryFixture();
  const gate = deferred<void>();
  let actions = 0;
  const first = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "slow", "fp", async () => {
    actions++;
    await gate.promise;
    return { body: { next: f.body }, update: { question: null } };
  }));
  await Promise.resolve();
  const duplicate = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "slow", "fp", f.noWork));
  gate.resolve();
  const [current, replay] = await Promise.all([first.result, duplicate.result]);
  expect(actions).toBe(1);
  expect(current).toEqual(replay);
  expect(current.status).toBe("ok");
  // Capacity removal, while both accepted HTTP consumers still own delivery holds.
  f.store.open(f.owner, newSupportQuestion("Replacement", "new-context"));
  expect(f.store.view(f.owner, f.session)).toBeNull();
  (closesFirst === "current" ? first : duplicate).release();
  expect(serializeTutorDiagram({ next: f.body }, f.owner)).toHaveProperty("next.diagram.image.svg", "<svg/>");
  (closesFirst === "current" ? duplicate : first).release();
  expect(tutorUmlArtifacts.wireDiagram(f.artifact, f.owner)).toBeNull();
});
it("releases a closed pending request's late delivery immediately while a live duplicate retains its own hold", async () => {
  const f = deliveryFixture();
  const gate = deferred<void>();
  const first = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "slow", "fp", async () => {
    await gate.promise;
    return { body: f.body, update: {} };
  }));
  await Promise.resolve();
  const duplicate = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "slow", "fp", f.noWork));
  first.release();
  gate.resolve();
  expect((await first.result).status).toBe("ok");
  expect((await duplicate.result).status).toBe("ok");
  f.expire();
  expect(serializeTutorDiagram(f.body, f.owner)).toHaveProperty("diagram.image.svg", "<svg/>");
  duplicate.release();
  expect(tutorUmlArtifacts.wireDiagram(f.artifact, f.owner)).toBeNull();
});
it("leaves no late-delivery hold when every pending consumer has already closed", async () => {
  const f = deliveryFixture();
  const gate = deferred<void>();
  const first = request(f.owner, f.session, () => f.store.run(f.owner, f.session, "slow", "fp", async () => {
    await gate.promise;
    return { body: f.body, update: {} };
  }));
  first.release();
  gate.resolve();
  expect((await first.result).status).toBe("ok");
  f.expire();
  expect(tutorUmlArtifacts.wireDiagram(f.artifact, f.owner)).toBeNull();
});

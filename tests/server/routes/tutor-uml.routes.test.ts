import express from "express";
import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { TutorService } from "../../../server/services/tutor/tutor-service";
import { tutorReviewEnvelopeSchema } from "@shared/tutor-review";
import { newSupportQuestion, TutorSupportStore } from "../../../server/services/tutor/learning-support-store";
import { tutorUmlArtifacts, tutorUmlSupportLifecycle } from "../../../server/services/tutor/uml/service";
import { config } from "../../../server/config";

let server: Server | undefined;
afterEach(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve()); });
const code = "void arbeiten() {\n x++;\n}";
const question = "Welche Anweisung folgt auf den Aufruf von arbeiten?";
const proposal = { version: 1, profile: "uml1-classic-v1", status: "diagram", kind: "activity", purpose: "Zeigt die Schritte der Funktion für den Vergleich.", scope: { file: "main.ino", startLine: 1, endLine: 3 }, body: [{ type: "action", code: "x++;", ref: { file: "main.ino", startLine: 2, endLine: 2 } }] };
async function fixture(options: { initialStatus?: "provided" | "not-useful" | "unavailable"; philosophicalFirst?: boolean } = {}) {
  const calls: string[] = [];
  let providePrimary = true; let initials = 0; let explanations = 0; let dialogs = 0;
  const retained: unknown[] = [];
  const service = new TutorService({
    listModels: async () => ["callable"],
    generateLearningQuestion: async request => {
      if (request.userPrompt.includes("Aktuelle Frage:\n")) {
        calls.push("explanation");
        const feedback = ["Betrachte die Abfolge der Anweisungen.", "Ordne den Aufruf seinem Funktionskörper zu.", "Prüfe, welche Anweisung im betrachteten Ausschnitt steht."][explanations++];
        return { model: "response-label", result: { question, responseStyle: "normal" as const, feedback } };
      }
      calls.push("primary"); request.onModelSelected?.("callable");
      const dialog = request.userPrompt.startsWith("Führe");
      if (dialog && ++dialogs === 1 && options.philosophicalFirst) return { model: "response-label", result: { question, responseStyle: "philosophical" as const, feedback: "Ordne deine Überlegung dem aktuellen Sketch zu." } };
      const asked = dialog || ++initials === 1 ? question : "Welche Rolle hat die Reihenfolge in arbeiten?";
      const result = { model: "response-label", result: { question: asked, responseStyle: "normal" as const, ...(dialog ? { feedback: "Betrachte die Reihenfolge der Anweisungen.", answerRating: 2 as const } : {}) }, ...(providePrimary ? { diagramProposal: options.initialStatus === "not-useful" ? { version: 1, profile: "uml1-classic-v1", status: "not-useful", reason: "no-useful-context", explanation: "Keine zusätzliche hilfreiche Darstellung." } : proposal } : {}) };
      providePrimary = false; return result;
    },
    generateGraphic: async () => { calls.push("extra"); return { model: "response-label", result: { diagram: proposal } }; },
  }, undefined, { renderer: { available: async () => options.initialStatus !== "unavailable", render: async () => { calls.push("render"); return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>', width: 100, height: 100, bytes: 74, rendererRevision: "test-v1" }; } } });
  const app = express(); app.use(express.json());
  app.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "uml-route-owner", roles: ["user"] }; next(); });
  const supportStore = new TutorSupportStore(undefined, undefined, {
    ...tutorUmlSupportLifecycle,
    referencesChanged: (owner, session, refs) => { tutorUmlSupportLifecycle.referencesChanged?.(owner, session, refs); retained.push(refs); },
  });
  registerTutorRoutes(app, { service, supportStore, disableRateLimit: true });
  server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
  const base = { code, entryFile: "main.ino", credential: "key", graphicsMode: "always", graphicsProfile: "uml1-classic-v1" };
  const post = async (endpoint: string, body: object) => {
    const response = await fetch(`http://127.0.0.1:${(server!.address() as {port:number}).port}/api/tutor/${endpoint}`, { method: "POST", headers: { "content-type": "application/json", "x-unosim-tutor-debug": "1" }, body: JSON.stringify({ ...base, ...body }) });
    return { status: response.status, body: await response.json() };
  };
  return { post, calls, retained, service, supportStore };
}
it("adopts initial UML before request cleanup, retains it, and replays without model/render work", async () => {
  const { post, calls, retained } = await fixture();
  const first = await post("question", { learningSupport: true });
  expect(first.status).toBe(200); expect(first.body.diagram.image.svg).toContain("<svg"); expect(first.body).not.toHaveProperty("_diagramArtifact");
  const request = { supportSession: first.body.support.session, questionHandle: first.body.support.questionHandle, actionId: crypto.randomUUID(), question, answer: "Die Funktion arbeitet schrittweise.", history: [] };
  const second = await post("dialog", request);
  expect(second.status).toBe(200); expect(second.body.diagram).toEqual(first.body.diagram); expect(second.body.questionStatus).toBe("open");
  expect(calls).toEqual(["primary", "render", "primary"]);
  const replay = await post("dialog", request);
  expect(replay.status).toBe(200); expect(replay.body.diagram).toEqual(second.body.diagram); expect(calls).toEqual(["primary", "render", "primary"]);
  const changed = await post("dialog", { ...request, actionId: crypto.randomUUID(), code: "void arbeiten(){}" });
  expect(changed.status).toBe(200); expect(changed.body.diagram).toBeUndefined(); expect(calls).toEqual(["primary", "render", "primary", "primary"]);
  expect(JSON.stringify(retained)).not.toContain("<svg"); expect(JSON.stringify(retained)).not.toContain("test-v1");
});
it("the review contains the normalized proposal and never contains the image or private handle", async () => {
  const before = config.tutor.diagnosticsEnabled; config.tutor.diagnosticsEnabled = true;
  try {
    const { post } = await fixture();
    const first = await post("question", { learningSupport: true });
    expect(first.status).toBe(200);
    const review = tutorReviewEnvelopeSchema.parse(first.body.review);
    const uml = review.entries.find(entry => entry.kind === "uml");
    expect(uml).toMatchObject({ state: "provided", profile: "uml1-classic-v1" });
    expect(uml?.kind === "uml" && JSON.parse(uml.proposalJson!)).toEqual(proposal);
    expect(JSON.stringify(review)).not.toContain("<svg"); expect(JSON.stringify(review)).not.toContain("_diagramArtifact");
  } finally { config.tutor.diagnosticsEnabled = before; }
});

it("keeps typed help and clarifications text-only, then renders only the skipped-to question", async () => {
  const { post, calls, retained } = await fixture();
  const first = await post("question", { learningSupport: true });
  const binding = { supportSession: first.body.support.session, questionHandle: first.body.support.questionHandle, history: [] };
  const help = await post("dialog", { ...binding, question, answer: "Ich brauche einen Hinweis", actionId: crypto.randomUUID() });
  expect(help.status).toBe(200); expect(help.body.diagram).toBeUndefined(); expect(help.body.graphicStatus).toBeUndefined();
  for (let index = 0; index < 2; index++) {
    const clarification = await post("support", { ...binding, action: "clarify", actionId: crypto.randomUUID() });
    expect(clarification.status).toBe(200); expect(clarification.body.diagram).toBeUndefined();
  }
  expect(calls).toEqual(["primary", "render", "explanation", "explanation", "explanation"]);
  const skip = { ...binding, action: "skip", actionId: crypto.randomUUID() };
  const next = await post("support", skip);
  expect(next.status).toBe(200); expect(next.body.next.diagram.image.svg).toContain("<svg"); expect(next.body.next).not.toHaveProperty("_diagramArtifact");
  expect(calls).toEqual(["primary", "render", "explanation", "explanation", "explanation", "primary", "extra", "render"]);
  const replay = await post("support", skip);
  expect(replay.status).toBe(200); expect(replay.body.next.diagram).toEqual(next.body.next.diagram); expect(calls).toHaveLength(8);
  expect(JSON.stringify(retained)).not.toContain("<svg");
});
it("preserves the exact old service call arity when profile, mode and project files are absent", async () => {
  const { post, service } = await fixture();
  const initial = vi.spyOn(service, "generateQuestion");
  const dialog = vi.spyOn(service, "generateDialogResponse");
  const legacy = { graphicsProfile: undefined, graphicsMode: undefined, entryFile: undefined };
  expect((await post("question", legacy)).status).toBe(200);
  expect(initial.mock.calls[0]).toHaveLength(6);
  expect((await post("dialog", { ...legacy, history: [], question, answer: "Die Anweisung erhöht x." })).status).toBe(200);
  expect(dialog.mock.calls[0]).toHaveLength(9);
});

it.each(["provided", "not-useful", "unavailable"] as const)("retains delivered %s through philosophical reply, HTTP replay, and the next normal weak answer", async initialStatus => {
  const { post, calls } = await fixture({ initialStatus, philosophicalFirst: true });
  const first = await post("question", { learningSupport: true });
  expect(first.status).toBe(200); expect(first.body.graphicStatus).toBe(initialStatus);
  const binding = { supportSession: first.body.support.session, questionHandle: first.body.support.questionHandle, history: [], question, answer: "Die Anweisung verändert die Variable." };
  const request = { ...binding, actionId: crypto.randomUUID() };
  const philosophical = await post("dialog", request);
  expect(philosophical.status).toBe(200); expect(philosophical.body).toMatchObject({ responseStyle: "philosophical", question, questionStatus: "open", graphicStatus: initialStatus });
  expect(philosophical.body.diagram).toEqual(first.body.diagram);
  const replay = await post("dialog", request);
  expect(replay.status).toBe(200); expect(replay.body.diagram).toEqual(first.body.diagram); expect(replay.body.graphicStatus).toBe(initialStatus);
  const normal = await post("dialog", { ...binding, actionId: crypto.randomUUID() });
  expect(normal.status).toBe(200); expect(normal.body).toMatchObject({ responseStyle: "normal", question, questionStatus: "open", graphicStatus: initialStatus });
  expect(normal.body.diagram).toEqual(first.body.diagram);
  expect(calls).toEqual(initialStatus === "provided" ? ["primary", "render", "primary", "primary"] : ["primary", "primary", "primary"]);
});


function deliveryGate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it.each(["finish", "abort"] as const)("keeps an admitted HTTP replay through eviction and releases its pin on %s", async ending => {
  const { post, calls, supportStore } = await fixture();
  const first = await post("question", { learningSupport: true });
  const session = first.body.support.session as string;
  const owner = "uml-route-owner";
  const artifact = supportStore.view(owner, session)!.question!.diagramArtifact!;
  const request = { supportSession: session, questionHandle: first.body.support.questionHandle, actionId: crypto.randomUUID(), question, answer: "Die Funktion arbeitet schrittweise.", history: [] };
  const original = await post("dialog", request);
  for (let index = 0; index < 31; index++) await supportStore.run(owner, session, `fill-${index}`, "fp", async () => ({ body: {}, update: { question: null } }));
  const admitted = deliveryGate();
  const serialize = deliveryGate();
  const closed = deliveryGate();
  server!.once("request", (_req, response) => response.once("close", closed.resolve));
  const run = supportStore.run.bind(supportStore);
  const spy = vi.spyOn(supportStore, "run").mockImplementation(async (...args) => {
    const result = await run(...args);
    if (args[2] === request.actionId) { admitted.resolve(); await serialize.promise; }
    return result;
  });
  const controller = new AbortController();
  const url = `http://127.0.0.1:${(server!.address() as {port:number}).port}/api/tutor/dialog`;
  const replay = fetch(url, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ code, entryFile: "main.ino", credential: "key", graphicsMode: "always", graphicsProfile: "uml1-classic-v1", ...request }) });
  try {
    await admitted.promise;
    await run(owner, session, "last", "fp", async () => ({ body: {}, update: {} }));
    expect(tutorUmlArtifacts.wireDiagram(artifact, owner)).not.toBeNull();
    expect(calls).toEqual(["primary", "render", "primary"]);
    if (ending === "abort") {
      const rejection = expect(replay).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await rejection;
    } else {
      serialize.resolve();
      const response = await replay;
      expect(response.status).toBe(200);
      expect((await response.json()).diagram).toEqual(original.body.diagram);
    }
    await closed.promise;
    // The sole logical replay was evicted: finish/close must release the last canonical reference.
    expect(tutorUmlArtifacts.wireDiagram(artifact, owner)).toBeNull();
    expect(await run(owner, session, request.actionId, "different", async () => { throw new Error("spent replay ran"); })).toEqual({ status: "spent" });
  } finally {
    serialize.resolve();
    spy.mockRestore();
    // Remove the remaining empty session without changing production TTL configuration.
    for (let index = 0; index < config.tutor.sessions.maxSessionsPerSubject; index++) supportStore.open(owner, newSupportQuestion("Replacement", "new"));
  }
});

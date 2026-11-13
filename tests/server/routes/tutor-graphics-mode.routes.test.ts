import express from "express";
import type { Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { registerTutorRoutes } from "../../../server/routes/tutor.routes";
import { TutorService } from "../../../server/services/tutor/tutor-service";
import type { TutorResponse } from "../../../shared/tutor";
import type { TutorSupportResponse } from "../../../shared/tutor-support";

let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});
async function fixture(options: { weak?: boolean; graphicFails?: boolean; recoverGraphic?: boolean } = {}) {
  const calls: string[] = [];
  let initial = 0;
  let explanations = 0;
  let answers = 0;
  const service = new TutorService({
    async listModels() { return ["m"]; },
    async generateLearningQuestion(request) {
      if (request.userPrompt.includes("Aktuelle Frage:\n")) {
        calls.push("explanation");
        const current = request.userPrompt.split("Aktuelle Frage:\n")[1].split("\n")[0];
        return { model: "m", result: { question: current, responseStyle: "normal", feedback: ["Betrachte die Abfolge der Aufrufe.", "Der Kontext ist die Wiederholung innerhalb von loop.", "Ordne die genannte Funktion ihrem Platz im Programm zu."][explanations++] } };
      }
      calls.push("question");
      const recovered = options.recoverGraphic && request.userPrompt.startsWith("Führe") && ++answers === 1;
      const question = request.userPrompt.startsWith("Erzeuge")
        ? (++initial === 1 ? "Welche Aufgabe hat setup im Sketch?" : "Welche Wirkung hat digitalWrite in loop?")
        : options.weak ? request.userPrompt.split("Aktuelle Tutorfrage:\n")[1].split("\n")[0] : "Welche Rolle hat pinMode für Pin 13?";
      return { model: "m", result: { question, responseStyle: "normal", ...(recovered ? { mermaid: "flowchart LR\nA[Kontext] --> B[Aktion]" } : {}), ...(request.userPrompt.startsWith("Führe") ? { feedback: "Richtig.", answerRating: options.weak ? 2 : 5 } : {}) } };
    },
    async generateGraphic() { calls.push("graphic"); if (options.graphicFails) throw new Error("controlled"); return { model: "m", result: { mermaid: "flowchart LR\nA[Kontext] --> B[Aktion]" } }; },
  });
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.unosimIdentity = { subject: "graphics-test", roles: ["user"] }; next(); });
  registerTutorRoutes(app, { service, disableRateLimit: true });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const base = { code: "void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);}", credential: "key", model: "m", graphicsMode: "always" };
  const post = async (endpoint: string, body: object) => {
    const response = await fetch(`${url}/api/tutor/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, ...body }) });
    return { status: response.status, body: await response.json() };
  };
  const start = await post("question", { learningSupport: true });
  expect(start.status).toBe(200);
  const first = start.body as TutorResponse;
  const binding = { supportSession: first.support!.session, questionHandle: first.support!.questionHandle };
  return { post, first, binding, calls };
}

it("binds graphics mode to supported answer and replay; changed mode conflicts without generating again", async () => {
  const { post, first, binding, calls } = await fixture();
  expect(first.graphicStatus).toBe("provided");
  const action = { ...binding, actionId: crypto.randomUUID(), question: first.question, answer: "setup läuft einmal.", history: [] };
  const answer = await post("dialog", action);
  expect(answer.status).toBe(200);
  expect(answer.body).toMatchObject({ graphicStatus: "provided", answerRating: 5, questionStatus: "closed" });
  expect(calls).toEqual(["question", "graphic", "question", "graphic"]);
  const replay = await post("dialog", action);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(answer.body);
  const conflict = await post("dialog", { ...action, graphicsMode: "auto" });
  expect(conflict.status).toBe(409);
  expect(calls).toHaveLength(4);
});

it("keeps typed help and clarifications text-only, then requests a graphic for skip's next question", async () => {
  const { post, first, binding, calls } = await fixture();
  const help = await post("dialog", { ...binding, actionId: crypto.randomUUID(), question: first.question, answer: "Ich brauche einen Hinweis", history: [] });
  expect(help.status).toBe(200);
  expect(help.body).not.toHaveProperty("graphicStatus");
  const clarify = await post("support", { ...binding, actionId: crypto.randomUUID(), action: "clarify", history: [] });
  expect(clarify.status).toBe(200);
  // The second explanation must be distinct to satisfy the real repetition guard.
  const clarify2 = await post("support", { ...binding, actionId: crypto.randomUUID(), action: "clarify", history: [] });
  expect(clarify2.status).toBe(200);
  expect(calls.filter((call) => call === "graphic")).toHaveLength(1);
  const next = await post("support", { ...binding, actionId: crypto.randomUUID(), action: "skip", history: [] });
  expect(next.status).toBe(200);
  expect((next.body as TutorSupportResponse).next).toMatchObject({ graphicStatus: "provided", question: "Welche Wirkung hat digitalWrite in loop?" });
  expect(calls.filter((call) => call === "graphic")).toHaveLength(2);
});


it.each([false, true])("preserves the explicit graphic state on a retained question but discards it on a code change (failure %s)", async (graphicFails) => {
  const { post, first, binding, calls } = await fixture({ weak: true, graphicFails });
  const body = { ...binding, question: first.question, answer: "Eine ungenaue fachliche Antwort", history: [] };
  const retained = await post("dialog", { ...body, actionId: crypto.randomUUID() });
  expect(retained.status).toBe(200);
  expect(retained.body).toMatchObject({ questionStatus: "open", question: first.question, graphicStatus: graphicFails ? "unavailable" : "provided" });
  expect(retained.body.mermaid).toBe(first.mermaid);
  expect(calls.filter((call) => call === "graphic")).toHaveLength(1);
  const changed = await post("dialog", { ...body, actionId: crypto.randomUUID(), code: "void setup(){} void loop(){}" });
  expect(changed.status).toBe(200);
  expect(changed.body).not.toHaveProperty("graphicStatus");
  expect(changed.body).not.toHaveProperty("mermaid");
  expect(calls.filter((call) => call === "graphic")).toHaveLength(1);
});


it("remembers an accepted primary graphic across further weak attempts after an initial graphic failure", async () => {
  const { post, first, binding, calls } = await fixture({ weak: true, graphicFails: true, recoverGraphic: true });
  expect(first.graphicStatus).toBe("unavailable");
  const request = { ...binding, question: first.question, answer: "Eine ungenaue fachliche Antwort", history: [] };
  const recovered = await post("dialog", { ...request, actionId: crypto.randomUUID() });
  expect(recovered.status).toBe(200);
  expect(recovered.body).toMatchObject({ graphicStatus: "provided", mermaid: "flowchart LR\nA[Kontext] --> B[Aktion]" });
  const again = await post("dialog", { ...request, actionId: crypto.randomUUID() });
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ graphicStatus: "provided", mermaid: recovered.body.mermaid });
  expect(calls.filter((call) => call === "graphic")).toHaveLength(1);
});

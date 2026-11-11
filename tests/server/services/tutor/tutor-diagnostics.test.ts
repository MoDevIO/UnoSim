import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { diagnosticBytes, tutorDiagnosticEnvelopeSchema } from "../../../../shared/tutor-diagnostics";
import { getTutorDiagnostics, reportTutorDiagnostic, reportTutorModel, reportTutorModelList, withTutorDiagnostics } from "../../../../server/services/tutor/tutor-diagnostics";

describe("request-scoped Tutor diagnosis", () => {
  it("protects the effective trimmed credential and does not reuse it as a diagnostic ID", () => {
    const credential = randomUUID();
    withTutorDiagnostics({ traceId: credential, requestId: randomUUID(), operation: "question", credential: `  ${credential}  ` }, () => {
      reportTutorModelList(["model", credential]);
      reportTutorModel("model", credential);
      const result = getTutorDiagnostics()!;
      expect(result.traceId).not.toBe(credential);
      expect(JSON.stringify(result)).not.toContain(credential);
    });
  });
  it("isolates concurrent requests and never exports raw or unlisted model metadata", async () => {
    const results = await Promise.all(["a", "b"].map(async (name) => withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "question", credential: "PRIVATE_KEY" }, async () => {
      reportTutorModelList([`model-${name}`, "PRIVATE_KEY"]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      reportTutorModel(`model-${name}`, "PRIVATE_KEY");
      reportTutorDiagnostic({ origin: "service", stage: "content", outcome: "accepted", question: "PRIVATE_DIALOG" } as never);
      return getTutorDiagnostics()!;
    })));
    expect(results[0].requestId).not.toBe(results[1].requestId);
    expect(JSON.stringify(results)).not.toContain("PRIVATE");
    expect(results[0].events.some((event) => event.modelRequested === "model-a")).toBe(true);
    expect(results[0].events.some((event) => event.modelRequested === "model-b")).toBe(false);
    expect(results[0].events.some((event) => event.reason === "model-id-withheld")).toBe(true);
  });

  // KI:connect answers a listed alias such as `openai-gpt5.5` with a provider-specific version name.
  it("shows a safe returned version name next to the listed requested model without a warning", () => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "answer", credential: "PRIVATE_KEY" }, () => {
      reportTutorModelList(["openai-gpt5.5"]);
      reportTutorModel("openai-gpt5.5");
      reportTutorModel("openai-gpt5.5", "gpt-5.5-2026-08-07");
      const completed = getTutorDiagnostics()!.events.find((event) => event.outcome === "completed");
      expect(completed).toMatchObject({ modelRequested: "openai-gpt5.5", modelReturned: "gpt-5.5-2026-08-07" });
      expect(completed?.reason).toBeUndefined();
    });
  });

  it.each([
    ["contains whitespace and a line break", "gpt 5.5\nInjected"],
    ["is longer than 128 characters", `m${"x".repeat(128)}`],
    ["contains the credential", "gpt-PRIVATE_KEY"],
  ])("withholds a returned model name that %s", (_case, returned) => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "answer", credential: "PRIVATE_KEY" }, () => {
      reportTutorModelList(["openai-gpt5.5"]);
      reportTutorModel("openai-gpt5.5", returned);
      const completed = getTutorDiagnostics()!.events.find((event) => event.outcome === "completed");
      expect(completed).toMatchObject({ modelRequested: "openai-gpt5.5", reason: "model-id-withheld" });
      expect(completed?.modelReturned).toBeUndefined();
    });
  });

  it("keeps a requested name the provider did not list out of the event", () => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "answer" }, () => {
      reportTutorModelList(["openai-gpt5.5"]);
      reportTutorModel("typed-by-the-user", "gpt-5.5-2026-08-07");
      const completed = getTutorDiagnostics()!.events.find((event) => event.outcome === "completed");
      expect(completed).toMatchObject({ modelReturned: "gpt-5.5-2026-08-07", reason: "model-id-not-listed" });
      expect(completed?.modelRequested).toBeUndefined();
    });
  });

  it("does not let the general event API attach a model name other than the reported one", () => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "answer" }, () => {
      reportTutorModelList(["openai-gpt5.5"]);
      reportTutorModel("openai-gpt5.5", "gpt-5.5-2026-08-07");
      reportTutorDiagnostic({ origin: "service", stage: "content", outcome: "accepted", modelReturned: "other-model" });
      const content = getTutorDiagnostics()!.events.find((event) => event.stage === "content");
      expect(content?.modelReturned).toBeUndefined();
    });
  });

  it("bounds the collector while preserving the terminal result and truncation evidence", () => {
    withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "question" }, () => {
      for (let i = 0; i < 200; i++) reportTutorDiagnostic({ origin: "service", stage: "safety", outcome: "accepted" });
      reportTutorDiagnostic({ origin: "service", stage: "request", outcome: "completed", statusCode: 200 });
      const result = getTutorDiagnostics()!;
      expect(tutorDiagnosticEnvelopeSchema.safeParse(result).success).toBe(true);
      expect(result.events.length).toBeLessThanOrEqual(64);
      expect(diagnosticBytes(result)).toBeLessThanOrEqual(32_768);
      expect(result.truncated).toBeGreaterThan(0);
      expect(result.events.some((event) => event.stage === "request" && event.outcome === "completed")).toBe(true);
    });
    expect(getTutorDiagnostics()).toBeUndefined();
  });
});

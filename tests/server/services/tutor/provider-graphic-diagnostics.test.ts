import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { KiconnectProvider } from "../../../../server/services/tutor/kiconnect-provider";
import { TutorService } from "../../../../server/services/tutor/tutor-service";
import { getTutorDiagnostics, withTutorDiagnostics } from "../../../../server/services/tutor/tutor-diagnostics";

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: "absent", value: undefined, outcome: "not-provided", reason: "not-provided" },
  { name: "null", value: null, outcome: "null", reason: "null-field" },
  { name: "empty", value: "", outcome: "empty", reason: "empty" },
  { name: "wrong type", value: 7, outcome: "rejected", reason: "invalid-field-type" },
  { name: "oversized", value: `flowchart LR\n${"x".repeat(12_000)}`, outcome: "rejected", reason: "too-long" },
  { name: "valid", value: "flowchart LR\nA --> B", outcome: "provided", reason: undefined },
])("distinguishes the real Provider's $name graphic field before it disappears", async ({ value, outcome, reason }) => {
  vi.stubGlobal("fetch", async (url: string) => new Response(JSON.stringify(url.endsWith("/models")
    ? { data: [{ id: "model" }] }
    : { model: "model", choices: [{ message: { content: JSON.stringify({ question: "PRIVATE_QUESTION_SENTINEL?", mermaid: value }) } }] }), { status: 200 }));
  await withTutorDiagnostics({ traceId: randomUUID(), requestId: randomUUID(), operation: "question", credential: "synthetic-key" }, async () => {
    const delivered = await new TutorService(new KiconnectProvider()).generateQuestion("void setup() {} void loop() {}", "synthetic-key", "model");
    const diagnostics = getTutorDiagnostics()!;
    const field = diagnostics.events.find((event) => event.stage === "parsing");
    expect(field?.outcome).toBe(outcome);
    expect(field?.reason).toBe(reason);
    expect(delivered.result.mermaid).toBe(outcome === "provided" ? value : undefined);
    expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_QUESTION_SENTINEL");
    expect(JSON.stringify(diagnostics)).not.toContain("synthetic-key");
    expect(JSON.stringify(diagnostics)).not.toContain("flowchart LR");
  });
});

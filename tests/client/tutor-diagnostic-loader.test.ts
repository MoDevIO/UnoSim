import { afterEach, expect, it, vi } from "vitest";
import { tutorDiagnosticFetch } from "@/lib/tutor-diagnostics";

vi.mock("@/lib/tutor-diagnostic-runtime", () => { throw new Error("PRIVATE_LOADER_DETAIL"); });
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

it("keeps normal learning requests usable when the optional diagnostic runtime cannot load", async () => {
  localStorage.setItem("unoDebugMode", "1");
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Welche Funktion beginnt?" }), { status: 200 });
  });
  const body = await (await tutorDiagnosticFetch("/api/tutor/question", { method: "POST" })).json();
  expect(body.question).toBe("Welche Funktion beginnt?");
  expect(calls).toBe(1);
});

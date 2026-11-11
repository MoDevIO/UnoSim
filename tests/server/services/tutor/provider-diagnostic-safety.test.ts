import { afterEach, expect, it, vi } from "vitest";
import { config } from "../../../../server/config";
import { KiconnectProvider } from "../../../../server/services/tutor/kiconnect-provider";
import { markTestAsFailed, setLogLevel } from "../../../../shared/logger";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setLogLevel("WARN"); });

it("never flushes raw invalid model content into development logs", async () => {
  const sentinel = "PRIVATE_DIALOG_SENTINEL_77";
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  const previous = config.nodeEnv;
  (config as { nodeEnv: string }).nodeEnv = "development";
  setLogLevel("DEBUG");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    model: "model", choices: [{ message: { content: JSON.stringify({ feedback: sentinel }) } }],
  }), { status: 200 }));
  try {
    await expect(new KiconnectProvider().generateLearningQuestion({ model: "model", systemPrompt: "system", userPrompt: "user" }, "request-only-key"))
      .rejects.toMatchObject({ kind: "invalid-response" });
    markTestAsFailed("explicit diagnostic flush probe");
    expect([...errors.mock.calls, ...logs.mock.calls].flat().join(" ")).not.toContain(sentinel);
  } finally {
    (config as { nodeEnv: string }).nodeEnv = previous;
  }
});

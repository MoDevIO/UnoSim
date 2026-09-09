import { afterEach, describe, expect, it, vi } from "vitest";
import { KiconnectProvider } from "../../../../server/services/tutor/kiconnect-provider";

describe("KiconnectProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the current model list from the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "pilot-model" }, { id: "pilot-model" }, { id: "second-model" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new KiconnectProvider().listModels("request-key")).resolves.toEqual([
      "pilot-model",
      "second-model",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.kiconnect.nrw/api/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer request-key" } }),
    );
  });

  it("uses the server-configured OpenAI-compatible endpoint and parses structured JSON", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "pilot-model" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "```json\n{\"feedback\":\"Deine Begründung geht in die richtige Richtung.\",\"question\":\"Was ändert sich, wenn der Pegel erneut gesetzt wird?\",\"topic\":null,\"difficulty\":null,\"mermaid\":null}\n```" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KiconnectProvider().generateLearningQuestion({
      model: "auto",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key");

    expect(result).toEqual({
      model: "pilot-model",
      result: {
        feedback: "Deine Begründung geht in die richtige Richtung.",
        question: "Was ändert sich, wenn der Pegel erneut gesetzt wird?",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://chat.kiconnect.nrw/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer request-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "pilot-model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("response_format");
  });

  it("accepts normal text and text-part content when structured output is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: [{ type: "text", text: "Welche Ausgabe erwartest du?" }] } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new KiconnectProvider().generateLearningQuestion({
      model: "pilot-model",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key")).resolves.toMatchObject({
      result: { question: "Welche Ausgabe erwartest du?" },
    });
  });

  it("maps provider authentication failures without exposing provider details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));

    await expect(new KiconnectProvider().generateLearningQuestion({
      model: "pilot-model",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key")).rejects.toMatchObject({ kind: "credential-invalid" });
  });
});

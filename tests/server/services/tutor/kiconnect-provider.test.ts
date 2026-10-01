import { afterEach, describe, expect, it, vi } from "vitest";
import { KiconnectProvider, TUTOR_TEMPERATURE } from "../../../../server/services/tutor/kiconnect-provider";
import { config } from "../../../../server/config";

describe("KiconnectProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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
        model: "pilot-model-resolved",
        choices: [{ message: { content: "```json\n{\"responseStyle\":\"normal\",\"feedback\":\"Deine Begründung geht in die richtige Richtung.\",\"answerRating\":\"4\",\"question\":\"Was ändert sich, wenn der Pegel erneut gesetzt wird?\",\"topic\":null,\"difficulty\":\"70\",\"mermaid\":null}\n```" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KiconnectProvider().generateLearningQuestion({
      model: "auto",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key");

    expect(result).toEqual({
      model: "pilot-model-resolved",
      result: {
        feedback: "Deine Begründung geht in die richtige Richtung.",
        answerRating: 4,
        responseStyle: "normal",
        question: "Was ändert sich, wenn der Pegel erneut gesetzt wird?",
        difficulty: 70,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://chat.kiconnect.nrw/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer request-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "pilot-model",
      temperature: TUTOR_TEMPERATURE,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "user" },
      ],
    });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("response_format");
  });

  it("requests JSON-object output and returns the response model with the parsed value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "judge-returned-model",
      choices: [{ message: { content: "{\"verdict\":\"supported\",\"score\":2}" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KiconnectProvider().generateStructuredResponse({
      model: "judge-requested-model",
      systemPrompt: "judge system",
      userPrompt: "judge user",
      temperature: 0,
    }, "request-key");

    expect(result).toEqual({
      model: "judge-returned-model",
      result: { verdict: "supported", score: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chat.kiconnect.nrw/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer request-key");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "judge-requested-model",
      temperature: 0,
      messages: [
        { role: "system", content: "judge system" },
        { role: "user", content: "judge user" },
      ],
      response_format: { type: "json_object" },
    });
  });

  it("preserves missing returned-model metadata instead of substituting the requested model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }), { status: 200 })));

    await expect(new KiconnectProvider().generateStructuredResponse({
      model: "judge-requested-model",
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0,
    }, "request-key")).resolves.toEqual({ model: undefined, result: { ok: true } });
  });

  it("rejects a malformed structured JSON response as invalid-response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "judge-model",
      choices: [{ message: { content: "{not-json}" } }],
    }), { status: 200 })));

    await expect(new KiconnectProvider().generateStructuredResponse({
      model: "judge-model",
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0,
    }, "request-key")).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("maps structured completion authentication errors through the provider error boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));

    await expect(new KiconnectProvider().generateStructuredResponse({
      model: "judge-model",
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0,
    }, "request-key")).rejects.toMatchObject({ kind: "credential-invalid" });
  });

  it("maps structured completion aborts to provider-timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));

    const pending = new KiconnectProvider().generateStructuredResponse({
      model: "judge-model",
      systemPrompt: "system",
      userPrompt: "user",
      temperature: 0,
    }, "request-key");
    const timeoutAssertion = expect(pending).rejects.toMatchObject({ kind: "provider-timeout" });
    await vi.advanceTimersByTimeAsync(config.tutor.timeoutMs);

    await timeoutAssertion;
  });

  it("prefers an available Qwen family for Automatic selection without requiring a fixed deployment ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: "mistralai-mistral-small-2503" },
          { id: "qwen3-32b-instruct" },
          { id: "llama-3.3-70b-instruct" },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "qwen3-32b-instruct",
        choices: [{ message: { content: "Welche Wirkung hat digitalWrite(13, HIGH)?" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new KiconnectProvider().generateLearningQuestion({
      model: "auto",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key");

    expect(result.model).toBe("qwen3-32b-instruct");
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toMatchObject({
      model: "qwen3-32b-instruct",
    });
  });

  it("accepts normal text and text-part content when structured output is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "pilot-model",
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

  it("fails closed when the Tutor response omits resolved-model provenance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Welche Ausgabe erwartest du?" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new KiconnectProvider().generateLearningQuestion({
      model: "pilot-model",
      systemPrompt: "system",
      userPrompt: "user",
    }, "request-key")).rejects.toMatchObject({ kind: "invalid-response" });
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

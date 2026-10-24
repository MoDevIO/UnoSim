import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTutor } from "@/hooks/use-tutor";

/** The Tutor sees what the compiler sees: entry file, headers and the selected board (LearningQuestions SSOT). */
describe("useTutor: sketch of a request", () => {
  afterEach(() => vi.restoreAllMocks());

  function mockTutorServer() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/config") return new Response(JSON.stringify({ tutor: { provider: "kiconnect" } }), { status: 200 });
      if (url === "/api/tutor/models") return new Response(JSON.stringify({ models: ["pilot-model"] }), { status: 200 });
      return new Response(JSON.stringify({ question: "Welche LED leuchtet?", provider: "kiconnect", model: "pilot-model" }), { status: 200 });
    });
  }

  const bodyOf = (fetchMock: ReturnType<typeof mockTutorServer>, route: string) =>
    JSON.parse(String(fetchMock.mock.calls.find(([input]) => String(input) === route)?.[1]?.body));

  it("sends the entry file, the headers and the board with question and dialog", async () => {
    const fetchMock = mockTutorServer();
    const sketch = {
      code: '#include "leds.h"\nvoid setup(){} void loop(){}',
      headers: [{ name: "leds.h", content: "const int LED = 9;" }],
      entryFile: "blink.ino",
      board: "attiny85" as const,
    };
    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("personal-key"));
    await act(async () => {
      await result.current.generateQuestion(sketch);
    });
    act(() => result.current.setAnswer("Pin 9"));
    await act(async () => {
      await result.current.submitAnswer(sketch);
    });

    for (const route of ["/api/tutor/question", "/api/tutor/dialog"]) {
      expect(bodyOf(fetchMock, route)).toMatchObject({ code: sketch.code, headers: sketch.headers, entryFile: "blink.ino", board: "attiny85" });
    }
  });

  it("sends only the code for a lone sketch", async () => {
    const fetchMock = mockTutorServer();
    const { result } = renderHook(() => useTutor());
    act(() => result.current.setCredential("personal-key"));
    await act(async () => {
      await result.current.generateQuestion("void setup(){} void loop(){}");
    });

    const body = bodyOf(fetchMock, "/api/tutor/question");
    expect(body.code).toBe("void setup(){} void loop(){}");
    expect(body).not.toHaveProperty("headers");
    expect(body).not.toHaveProperty("board");
  });
});

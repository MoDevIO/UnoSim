import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_RUNTIME_CONFIG, loadRuntimeConfig, parseRuntimeConfig, resetRuntimeConfigCache } from "../../../../client/src/lib/runtime/runtime-config";

const full = {
  healthPollIntervalMs: 15000,
  boards: [
    { id: "uno", displayName: "Arduino UNO", status: "available", runtimes: ["browser", "host-mock"] },
    { id: "nano", displayName: "Arduino Nano", status: "preview", runtimes: ["browser"] },
  ],
  defaultBoard: "uno",
  runtime: { backends: ["browser", "host-mock"], default: "host-mock" },
};

describe("parseRuntimeConfig (plan 4.11)", () => {
  it("reads backends, default runtime, boards and default board", () => {
    expect(parseRuntimeConfig(full)).toEqual({
      backends: ["browser", "host-mock"],
      defaultRuntime: "host-mock",
      boards: [
        { id: "uno", displayName: "Arduino UNO", runtimes: ["browser", "host-mock"] },
        { id: "nano", displayName: "Arduino Nano", runtimes: ["browser"] },
      ],
      defaultBoard: "uno",
    });
  });

  it.each([
    ["null", null],
    ["a string", "config"],
    ["a server without runtime fields", { healthPollIntervalMs: 1 }],
    ["an empty backend list", { ...full, runtime: { backends: [], default: "host-mock" } }],
    ["only unknown backends", { ...full, runtime: { backends: ["wasm"], default: "wasm" } }],
  ])("falls back to the Uno with the host mock for %s", (_name, json) => {
    expect(parseRuntimeConfig(json)).toEqual(FALLBACK_RUNTIME_CONFIG);
  });

  it("drops unknown backends and boards and repairs a default that is not offered", () => {
    const parsed = parseRuntimeConfig({
      boards: [{ id: "esp32", displayName: "ESP", runtimes: ["browser"] }, { id: "nano", displayName: "Arduino Nano", runtimes: ["browser", "wasm"] }, { id: "uno" }],
      defaultBoard: "esp32",
      runtime: { backends: ["browser", "wasm"], default: "host-mock" },
    });

    expect(parsed).toEqual({
      backends: ["browser"],
      defaultRuntime: "browser",
      boards: [{ id: "nano", displayName: "Arduino Nano", runtimes: ["browser"] }],
      defaultBoard: "nano",
    });
  });

  it("gives the Uno the offered backends when the server lists no boards", () => {
    const parsed = parseRuntimeConfig({ runtime: { backends: ["browser", "host-mock"], default: "browser" } });

    expect(parsed.boards).toEqual([{ id: "uno", displayName: "Arduino UNO", runtimes: ["browser", "host-mock"] }]);
    expect(parsed.defaultRuntime).toBe("browser");
  });
});

describe("loadRuntimeConfig", () => {
  beforeEach(() => resetRuntimeConfigCache());

  const answering = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

  it("asks the server once per page view", async () => {
    const request = answering(full);

    const first = await loadRuntimeConfig(request as never);
    const second = await loadRuntimeConfig(request as never);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/config", expect.objectContaining({ cache: "no-store" }));
    expect(second).toBe(first);
    expect(first.backends).toEqual(["browser", "host-mock"]);
  });

  it("answers with the fallback on an HTTP error or a failed request and asks again next time", async () => {
    const failing = answering({}, false);
    const rejecting = vi.fn().mockRejectedValue(new Error("offline"));

    expect(await loadRuntimeConfig(failing as never)).toEqual(FALLBACK_RUNTIME_CONFIG);
    expect(await loadRuntimeConfig(rejecting as never)).toEqual(FALLBACK_RUNTIME_CONFIG);
    expect(await loadRuntimeConfig(answering(full) as never)).toMatchObject({ defaultRuntime: "host-mock", backends: ["browser", "host-mock"] });
  });
});

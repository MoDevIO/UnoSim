import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSimulationRuntimeSelection } from "@/hooks/use-simulation-runtime";
import { resetRuntimeConfigCache } from "@/lib/runtime/runtime-config";
import { ENGINE_PREFERENCE_KEY } from "@/lib/runtime/runtime-selection";

const config = (runtime: unknown) => ({
  boards: [
    { id: "uno", displayName: "Arduino UNO", status: "available", runtimes: ["browser", "host-mock"] },
    { id: "nano", displayName: "Arduino Nano", status: "preview", runtimes: ["browser"] },
  ],
  defaultBoard: "uno",
  runtime,
});

function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
}

beforeEach(() => {
  resetRuntimeConfigCache();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSimulationRuntimeSelection (plan P3.1)", () => {
  it("starts with the fallback (host mock) and switches to the server's answer", async () => {
    serve(config({ backends: ["browser", "host-mock"], default: "browser" }));

    const { result } = renderHook(() => useSimulationRuntimeSelection());
    expect(result.current.runtimeKind).toBe("host-mock");

    await waitFor(() => expect(result.current.runtimeKind).toBe("browser"));
    expect(result.current.usable).toEqual(["browser", "host-mock"]);
  });

  it("honors the stored choice and follows changes made elsewhere on the page", async () => {
    serve(config({ backends: ["browser", "host-mock"], default: "browser" }));
    localStorage.setItem(ENGINE_PREFERENCE_KEY, "host-mock");

    const { result } = renderHook(() => useSimulationRuntimeSelection());
    await waitFor(() => expect(result.current.config.backends).toHaveLength(2));
    expect(result.current.runtimeKind).toBe("host-mock");

    act(() => result.current.setUserChoice("browser"));
    expect(result.current.runtimeKind).toBe("browser");
    expect(localStorage.getItem(ENGINE_PREFERENCE_KEY)).toBe("browser");

    act(() => result.current.setUserChoice(undefined));
    expect(result.current.userChoice).toBeUndefined();
    expect(result.current.runtimeKind).toBe("browser"); // the server default
  });

  it("limits the choice to what the board supports", async () => {
    serve(config({ backends: ["browser", "host-mock"], default: "host-mock" }));

    const { result } = renderHook(() => useSimulationRuntimeSelection("nano"));
    await waitFor(() => expect(result.current.config.backends).toHaveLength(2));

    expect(result.current.usable).toEqual(["browser"]);
    expect(result.current.runtimeKind).toBe("browser");
  });

  it("has no runtime for a board the server does not list", async () => {
    serve(config({ backends: ["host-mock"], default: "host-mock" }));

    const { result } = renderHook(() => useSimulationRuntimeSelection("nano"));
    await waitFor(() => expect(result.current.config.backends).toEqual(["host-mock"]));

    expect(result.current.runtimeKind).toBeUndefined();
  });
});

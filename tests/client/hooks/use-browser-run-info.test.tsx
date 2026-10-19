import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBrowserRunInfo } from "@/hooks/use-browser-run-info";
import { getRuntimeHub } from "@/lib/runtime/runtime-hub";

describe("useBrowserRunInfo (plan P3.5, P3.6)", () => {
  it("follows the browser run of the hub and takes the real-time factor from telemetry", async () => {
    const hub = getRuntimeHub();
    const { result } = renderHook(() => useBrowserRunInfo());
    expect(result.current).toEqual({ active: false });

    act(() => hub.setActive("browser"));
    expect(result.current).toEqual({ active: true });

    // The hub hands the runtime's browser-only events to its listeners; a fake runtime stands in for the real one.
    const listeners = (hub as unknown as { browserListeners: Set<(event: unknown) => void> }).browserListeners;
    act(() => {
      for (const listener of listeners) listener({ type: "runtime_telemetry", sample: { simTimeMs: 2000, realTimeFactor: 1.25, pinChangesPerSecond: 0, serialCharsPerSecond: 0, serialCharsDropped: 0 } });
    });
    expect(result.current).toEqual({ active: true, realTimeFactor: 1.25, simTimeMs: 2000 });

    act(() => hub.setActive("host-mock"));
    expect(result.current).toEqual({ active: false });
  });
});

import { describe, expect, it } from "vitest";
import { getServerCapabilities } from "@/lib/server-capabilities";

describe("server capabilities", () => {
  it("allows server dependent actions when the backend is reachable", () => {
    expect(getServerCapabilities(true)).toEqual({
      canCompile: true,
      canSimulate: true,
      canUseTutor: true,
      canConfigureTutor: true,
      canUseServerExamples: true,
      canUseRealtimeControls: true,
    });
  });

  it("blocks server dependent actions when the backend is offline", () => {
    expect(getServerCapabilities(false)).toEqual({
      canCompile: false,
      canSimulate: false,
      canUseTutor: false,
      canConfigureTutor: false,
      canUseServerExamples: false,
      canUseRealtimeControls: false,
    });
  });

  it("keeps the controls of a running browser emulation while the backend is offline, and nothing else", () => {
    expect(getServerCapabilities(false, true)).toEqual({
      canCompile: false,
      canSimulate: true,
      canUseTutor: false,
      canConfigureTutor: false,
      canUseServerExamples: false,
      canUseRealtimeControls: true,
    });
  });

  it("is unchanged by a browser run while the backend is reachable", () => {
    expect(getServerCapabilities(true, true)).toEqual(getServerCapabilities(true));
  });
});

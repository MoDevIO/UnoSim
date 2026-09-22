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
});

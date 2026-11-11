import { describe, expect, it } from "vitest";
import { getClientConfig, parseTutorDiagnosticsEnabled } from "../../server/config";

describe("Tutor diagnosis configuration", () => {
  it("defaults to development only and permits explicit operator override", () => {
    expect(parseTutorDiagnosticsEnabled(undefined, "development")).toBe(true);
    expect(parseTutorDiagnosticsEnabled(undefined, "production")).toBe(false);
    expect(parseTutorDiagnosticsEnabled(undefined, "test")).toBe(false);
    expect(parseTutorDiagnosticsEnabled("true", "production")).toBe(true);
    expect(parseTutorDiagnosticsEnabled("false", "development")).toBe(false);
    expect(() => parseTutorDiagnosticsEnabled("PRIVATE_CONFIG_SENTINEL", "production")).toThrow("expected true/false");
    try { parseTutorDiagnosticsEnabled("PRIVATE_CONFIG_SENTINEL", "production"); } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_CONFIG_SENTINEL");
    }
    expect(typeof getClientConfig().tutorDiagnosticsAvailable).toBe("boolean");
  });
});

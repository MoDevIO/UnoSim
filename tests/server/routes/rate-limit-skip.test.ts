import { describe, expect, it } from "vitest";
import { shouldSkipApiRateLimit } from "../../../server/rate-limit-policy";

describe("API rate-limit skip policy", () => {
  it.each([
    ["/api/status", false, true],
    ["/api/health", false, true],
    ["/api/config", false, true],
    ["/api/compile", false, false],
    ["/api/compile", true, true],
  ])(
    "%s in test mode=%s returns skip=%s",
    (path, isTestMode, expected) => {
      expect(shouldSkipApiRateLimit(path, isTestMode)).toBe(expected);
    },
  );
});

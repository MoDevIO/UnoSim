import { describe, expect, it } from "vitest";
import {
  HEADER_NAME_PATTERN,
  INPUT_LIMITS,
  TEST_RUN_ID_PATTERN,
} from "../../shared/input-limits";

describe("input boundary contract", () => {
  it("keeps all size and runtime limits finite and ordered", () => {
    expect(INPUT_LIMITS.compile.maxCodeChars).toBeGreaterThan(0);
    expect(INPUT_LIMITS.webSocket.maxPayloadBytes).toBeGreaterThan(
      INPUT_LIMITS.compile.maxCodeChars,
    );
    expect(INPUT_LIMITS.simulation.minTimeoutSeconds).toBeGreaterThan(0);
    expect(INPUT_LIMITS.simulation.maxTimeoutSeconds).toBeGreaterThanOrEqual(
      INPUT_LIMITS.simulation.defaultTimeoutSeconds,
    );
    expect(INPUT_LIMITS.simulation.maxPin).toBeGreaterThanOrEqual(
      INPUT_LIMITS.simulation.minPin,
    );
  });

  it("accepts only safe artifact identifiers and header basenames", () => {
    expect(TEST_RUN_ID_PATTERN.test("test_run-42")).toBe(true);
    expect(TEST_RUN_ID_PATTERN.test("../escape")).toBe(false);
    expect(HEADER_NAME_PATTERN.test("helper.h")).toBe(true);
    expect(HEADER_NAME_PATTERN.test("../helper.h")).toBe(false);
    expect(HEADER_NAME_PATTERN.test("/tmp/helper.h")).toBe(false);
  });
});

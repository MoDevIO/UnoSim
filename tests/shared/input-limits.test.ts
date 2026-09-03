import { describe, expect, it } from "vitest";
import {
  HEADER_NAME_PATTERN,
  INPUT_LIMITS,
  isSafeHeaderName,
  normalizeBaudrate,
  normalizeSimulationTimeout,
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
    expect(INPUT_LIMITS.simulation.maxPinValue).toBe(1023);
  });

  it("accepts only safe artifact identifiers and header basenames", () => {
    expect(TEST_RUN_ID_PATTERN.test("test_run-42")).toBe(true);
    expect(TEST_RUN_ID_PATTERN.test("../escape")).toBe(false);
    expect(HEADER_NAME_PATTERN.test("helper.h")).toBe(true);
    expect(HEADER_NAME_PATTERN.test("../helper.h")).toBe(false);
    expect(HEADER_NAME_PATTERN.test("/tmp/helper.h")).toBe(false);
    expect(isSafeHeaderName("CON.h")).toBe(false);
  });

  it("keeps runtime timeout and baudrate values inside finite limits", () => {
    expect(normalizeSimulationTimeout(undefined)).toBe(60);
    expect(normalizeSimulationTimeout(0)).toBe(60);
    expect(normalizeSimulationTimeout(900)).toBe(300);
    expect(normalizeBaudrate(115200)).toBe(115200);
    expect(normalizeBaudrate(0)).toBe(9600);
    expect(normalizeBaudrate(999999)).toBe(9600);
  });
});

import { describe, expect, it } from "vitest";
import {
  decideLiveOutcome,
  parseLiveEvaluationOptions,
  type LiveCheck,
} from "../../../../../server/services/tutor/evaluation/learning-support-live";

/** Evidence rules of the live learning-support evaluation (review R9). */

const app = (passed: boolean): LiveCheck => ({ id: "application-accepts:1", layer: "application", passed, detail: "" });
const model = (passed: boolean): LiveCheck => ({ id: "model-accepts:1", layer: "model", passed, detail: "" });

describe("live evaluation options", () => {
  it("rejects a sample count that is not an integer from 1 to 10 instead of running none", () => {
    for (const samples of ["not-a-number", "0", "11", "2.5", "-1", ""]) {
      expect(() => parseLiveEvaluationOptions(["--samples", samples, "--output-dir", "out"])).toThrow();
    }
    expect(parseLiveEvaluationOptions(["--samples", "5", "--output-dir", "out"])).toMatchObject({ samples: 5, model: "auto" });
  });

  it("requires an output directory and rejects unknown options, missing values and invalid names", () => {
    expect(() => parseLiveEvaluationOptions([])).toThrow("--output-dir is required");
    expect(() => parseLiveEvaluationOptions(["--output-dir"])).toThrow();
    expect(() => parseLiveEvaluationOptions(["--output-dir", "out", "--judge", "x"])).toThrow("Unknown option");
    expect(() => parseLiveEvaluationOptions(["--output-dir", "out", "--model", "bad model!"])).toThrow();
    expect(() => parseLiveEvaluationOptions(["--output-dir", "out", "--credential-env", "lower"])).toThrow();
  });
});

describe("live evaluation outcome", () => {
  it("passes only when every requested sample completed and all its application checks passed", () => {
    expect(decideLiveOutcome(2, [{ kind: "completed", checks: [app(true), model(false)] }, { kind: "completed", checks: [app(true)] }])).toBe("pass");
  });

  it("is never a pass without a completed sample or without an application check", () => {
    expect(decideLiveOutcome(0, [])).toBe("inconclusive");
    expect(decideLiveOutcome(3, [])).toBe("inconclusive");
    expect(decideLiveOutcome(1, [{ kind: "completed", checks: [model(true)] }])).toBe("inconclusive");
    expect(decideLiveOutcome(2, [{ kind: "completed", checks: [app(true)] }])).toBe("inconclusive");
  });

  it("is inconclusive with a provider failure and fails with a failed application check", () => {
    expect(decideLiveOutcome(2, [{ kind: "completed", checks: [app(true)] }, { kind: "technical", failure: "504 PROVIDER_TIMEOUT" }])).toBe("inconclusive");
    expect(decideLiveOutcome(2, [{ kind: "completed", checks: [app(false)] }, { kind: "technical", failure: "504" }])).toBe("fail");
  });
});

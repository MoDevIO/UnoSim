import { describe, expect, it } from "vitest";
import { parseTutorQualityCliArgs } from "../../../../../scripts/tutor-quality-real-provider-eval";

describe("Tutor Quality real-provider CLI contract", () => {
  it("requires a fixed model and accepts only a credential environment-variable name", () => {
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "auto"])).toThrow();
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--api-key", "secret"])).toThrow();

    expect(parseTutorQualityCliArgs([
      "--output-dir", "/tmp/tq",
      "--model", "pilot-model",
      "--samples", "2",
      "--max-calls", "12",
      "--credential-env", "TEST_TUTOR_CREDENTIAL",
    ])).toMatchObject({
      model: "pilot-model",
      samples: 2,
      maxCalls: 12,
      credentialEnv: "TEST_TUTOR_CREDENTIAL",
      outputDir: "/tmp/tq",
    });
  });

  it("rejects malformed numeric limits and credential values", () => {
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--samples", "0"])).toThrow();
    expect(() => parseTutorQualityCliArgs(["--output-dir", "/tmp/tq", "--model", "pilot", "--credential-env", "not-a-value"])).toThrow();
  });
});

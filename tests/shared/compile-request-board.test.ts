import { describe, expect, it } from "vitest";
import { compileRequestSchema } from "../../shared/schema";

const parse = (patch: Record<string, unknown>) => compileRequestSchema.safeParse({ code: "void setup() {}\nvoid loop() {}", ...patch });

describe("compile request: board and deprecated fqbn (plan P2.2)", () => {
  it("accepts a request without board and fqbn", () => {
    expect(parse({}).success).toBe(true);
  });

  it("accepts a catalog board", () => {
    const result = parse({ board: "nano" });

    expect(result.success && result.data.board).toBe("nano");
  });

  it("rejects an unknown board", () => {
    expect(parse({ board: "esp32" }).success).toBe(false);
  });

  it("accepts the fqbn of a catalog board, with or without its board", () => {
    expect(parse({ fqbn: "arduino:avr:uno" }).success).toBe(true);
    expect(parse({ board: "mega2560", fqbn: "arduino:avr:mega:cpu=atmega2560" }).success).toBe(true);
  });

  it("rejects an fqbn that belongs to another board than the one selected", () => {
    const result = parse({ board: "uno", fqbn: "arduino:avr:nano:cpu=atmega328" });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].message).toBe("fqbn does not belong to the selected board");
  });

  it("rejects an fqbn that is not in the catalog", () => {
    const result = parse({ fqbn: "esp32:esp32:esp32" });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].path).toEqual(["fqbn"]);
  });
});

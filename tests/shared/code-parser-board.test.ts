import { describe, expect, it } from "vitest";
import { CodeParser } from "../../shared/code-parser";

describe("CodeParser board (plan P2.2)", () => {
  it("parses for the Uno unless told otherwise", () => {
    expect(new CodeParser().board).toBe("uno");
  });

  it("keeps the board it is given, after the existing analyzer arguments", () => {
    expect(new CodeParser(undefined, undefined, "nano").board).toBe("nano");
  });
});

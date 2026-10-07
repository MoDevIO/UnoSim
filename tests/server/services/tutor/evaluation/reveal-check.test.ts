import { describe, expect, it } from "vitest";
import { findRevealedLiteral, isValidRevealLiteral } from "../../../../../server/services/tutor/evaluation/reveal-check";

describe("mustNotReveal literal matching (R-REV-2)", () => {
  it.each([
    ["Welcher Wert steht bei `int counter = 3;` im Sketch?"],
    ["Der Wert counter=3 wird ausgegeben."],
    ["COUNTER   =   3 steht in der Deklaration."],
    ["Was bedeutet **counter = 3**?"],
    ["Wie wirkt sich int counter = 3 aus?"],
  ])("matches the literal in: %s", (text) => {
    expect(findRevealedLiteral([text], ["counter = 3"])).toBe("counter = 3");
  });

  it.each([
    ["counter = 30 wäre ein anderer Wert."],
    ["mycounter = 3 ist eine andere Variable."],
    ["counter_total = 3 gehört nicht dazu."],
    ["Welchen Wert hat counter an dieser Stelle?"],
    ["Der Wert ist drei."],
  ])("does not match: %s", (text) => {
    expect(findRevealedLiteral([text], ["counter = 3"])).toBeUndefined();
  });

  it("searches every text and reports the declared literal", () => {
    expect(findRevealedLiteral(["Kein Treffer.", "Nun `counter = 3`?"], ["x = 1", "counter = 3"])).toBe("counter = 3");
  });

  it("does not join separate texts into one match", () => {
    expect(findRevealedLiteral(["counter =", "3"], ["counter = 3"])).toBeUndefined();
  });

  it.each([
    ["counter = 3", true],
    ["drei", true],
    ["3", false],
    ["= 3", false],
    ["  ", false],
    ["ab", false],
  ])("validates literal %j as %s", (literal, valid) => {
    expect(isValidRevealLiteral(literal)).toBe(valid);
  });
});

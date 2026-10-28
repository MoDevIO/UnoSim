import { describe, expect, it } from "vitest";
import { exampleBoardPrompt } from "../../../client/src/lib/example-board";

const uno = { id: "uno" as const, displayName: "Arduino UNO", status: "available" as const };
const nano = { id: "nano" as const, displayName: "Arduino Nano", status: "preview" as const };
const mega = { id: "mega2560" as const, displayName: "Arduino Mega 2560", status: "planned" as const };

describe("exampleBoardPrompt (plan P4.6)", () => {
  it("asks nothing for an example without board or for the selected board", () => {
    expect(exampleBoardPrompt(undefined, uno, [uno, nano])).toBeUndefined();
    expect(exampleBoardPrompt("uno", uno, [uno, nano])).toBeUndefined();
  });

  it("offers to switch to an offered board that can be selected", () => {
    expect(exampleBoardPrompt("nano", uno, [uno, nano])).toEqual({
      exampleBoard: "nano", exampleBoardName: "Arduino Nano", selectedBoardName: "Arduino UNO", canSwitch: true,
    });
  });

  it("cannot switch to a planned board or one the server does not offer", () => {
    expect(exampleBoardPrompt("mega2560", uno, [uno, mega])?.canSwitch).toBe(false);
    expect(exampleBoardPrompt("attiny85", uno, [uno, nano])).toMatchObject({ canSwitch: false, exampleBoardName: "attiny85" });
  });

  it("copes with an unknown selected board", () => {
    expect(exampleBoardPrompt("nano", undefined, [nano])?.selectedBoardName).toBe("the current board");
  });
});

import { describe, expect, it } from "vitest";
import { AVR_DATA_TYPE_BYTES, BOARD_IDS, boardTutorFacts } from "../../../../shared/boards";
import { TUTOR_SYSTEM_PROMPT, buildDialogPrompt, buildTutorContext, buildUserPrompt } from "../../../../server/services/tutor/tutor-service";

const sketch = "void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); }";

describe("Tutor context: board and data type sizes (plan P2.7)", () => {
  it("names the board, its MCU and the sizes of the AVR data types", () => {
    expect(boardTutorFacts("nano")).toEqual({
      id: "nano",
      displayName: "Arduino Nano",
      mcu: "atmega328p",
      dataTypeBytes: { char: 1, short: 2, int: 2, long: 4, longLong: 8, float: 4, double: 4, pointer: 2 },
    });
    for (const id of BOARD_IDS) expect(boardTutorFacts(id).dataTypeBytes).toBe(AVR_DATA_TYPE_BYTES);
  });

  it("adds the board to the deterministic context only when one is given", () => {
    expect(buildTutorContext(sketch)).not.toHaveProperty("board");
    expect(buildTutorContext(sketch, "uno").board).toEqual(boardTutorFacts("uno"));
    expect(buildTutorContext(sketch, "uno").staticIO).toEqual(buildTutorContext(sketch).staticIO);
  });

  it("hands the board facts to the model in question and dialog prompts", () => {
    const context = buildTutorContext(sketch, "attiny85");

    expect(buildUserPrompt(sketch, context)).toContain('"board":{"id":"attiny85","displayName":"ATtiny85","mcu":"attiny85"');
    expect(buildDialogPrompt(sketch, context, [], "Frage?", "Antwort")).toContain('"dataTypeBytes":{"char":1,"short":2,"int":2');
    expect(buildUserPrompt(sketch, buildTutorContext(sketch))).not.toContain('"board"');
  });

  it("tells the model in the application-owned system prompt to rely on those sizes", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain("Nennt der deterministische Kontext ein Board, gelten dessen Datentypgrößen");
    expect(TUTOR_SYSTEM_PROMPT).toContain("int 16 Bit");
  });
});

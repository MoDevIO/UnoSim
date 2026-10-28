import { describe, expect, it, vi } from "vitest";
import { AVR_DATA_TYPE_BYTES, BOARD_IDS, boardTutorFacts } from "../../../../shared/boards";
import { TUTOR_SYSTEM_PROMPT, TutorService, buildDialogPrompt, buildTutorContext, buildUserPrompt } from "../../../../server/services/tutor/tutor-service";

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

describe("Tutor context: pins of the board and files of the project", () => {
  const pinsOf = (code: string, source?: Parameters<typeof buildTutorContext>[1]) =>
    buildTutorContext(code, source).staticIO.pins.map(({ pinId }) => pinId);
  const led = "void setup() { pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop() {\n  int value = analogRead(A0);\n  digitalWrite(LED_BUILTIN, value > 512);\n}";

  it("resolves LED_BUILTIN and A0 with the pins of the given board", () => {
    expect(pinsOf(led, { board: "uno" })).toEqual([13, 14]);
    expect(pinsOf(led, { board: "mega2560" })).toEqual([13, 54]);
    expect(pinsOf(led, { board: "attiny85" })).toEqual([1, 5]);
  });

  it("analyses the headers of the project and names the file of a call outside the entry file", () => {
    const code = '#include "leds.h"\nvoid setup() { initLeds(); }\nvoid loop() {}';
    const headers = [{ name: "leds.h", content: "const int LED = 9;\nvoid initLeds() { pinMode(LED, OUTPUT); }" }];

    const context = buildTutorContext(code, { board: "uno", headers, entryFile: "blink.ino" });

    expect(context.staticIO.pins).toEqual([
      { pinId: 9, calls: [expect.objectContaining({ op: "pinMode", file: "leds.h", line: 2 })] },
    ]);
    expect(pinsOf(code, { board: "uno" })).toEqual([]);
  });
});

describe("Tutor prompt: files of the project", () => {
  it("shows every header in the sketch block, after a comment line that names it, and uses the board's pins", async () => {
    const generateLearningQuestion = vi.fn().mockResolvedValue({ model: "pilot-model", result: { question: "Welcher Pin ist LED?" } });
    const service = new TutorService({ listModels: vi.fn().mockResolvedValue(["pilot-model"]), generateLearningQuestion });
    const code = '#include "leds.h"\nvoid setup() { pinMode(LED, OUTPUT); }\nvoid loop() {}';

    await service.generateQuestion(code, "key", undefined, 30, undefined, undefined, {
      board: "attiny85", headers: [{ name: "leds.h", content: "const int LED = LED_BUILTIN;" }], entryFile: "blink.ino",
    });

    const prompt: string = generateLearningQuestion.mock.calls[0]?.[0].userPrompt;
    expect(prompt).toContain(`${code}\n\n// ---- Datei leds.h ----\nconst int LED = LED_BUILTIN;`);
    expect(prompt).toContain('"pins":[{"pinId":1,');
  });
});

import { describe, expect, it } from "vitest";
import { CodeParser } from "@shared/code-parser";
import type { BoardId } from "@shared/boards";

const serialMessages = (code: string, board?: BoardId) => new CodeParser(undefined, undefined, board).parseSerialConfiguration(code).map((message) => message.message);

const MEGA_SKETCH = `void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  Serial3.begin(57600);
}
void loop() {
  Serial1.println("a");
  Serial3.println("b");
  Serial.println("c");
}`;

describe("serial ports in the sketch analysis (plan P5.3, P5.4)", () => {
  it("accepts Serial1–Serial3 with begin() on the Mega 2560 without a message", () => {
    expect(serialMessages(MEGA_SKETCH, "mega2560")).toEqual([]);
  });

  it("names a port the Uno or the Nano does not have", () => {
    expect(serialMessages(MEGA_SKETCH, "uno")).toEqual([
      "Serial1 does not exist on Arduino UNO, which has only Serial.",
      "Serial3 does not exist on Arduino UNO, which has only Serial.",
    ]);
    expect(serialMessages("void setup() { Serial2.begin(9600); Serial2.print(1); }", "nano")).toEqual([
      "Serial2 does not exist on Arduino Nano, which has only Serial.",
    ]);
  });

  it("leaves the Uno's messages for sketches without Serial1–Serial3 as they were", () => {
    const code = "void setup() {}\nvoid loop() { Serial.println(1); }";
    expect(serialMessages(code)).toEqual(["Serial.begin(115200) is missing in setup(). Serial output may not work correctly."]);
    expect(serialMessages(code, "mega2560")).toEqual(serialMessages(code));
  });

  it("asks for begin() of a port that is used without it, and reports a commented-out begin()", () => {
    expect(serialMessages("void setup() { Serial.begin(115200); }\nvoid loop() { Serial2.println(1); }", "mega2560")).toEqual([
      "Serial2.begin(9600) is missing in setup(). Serial2 output may not work correctly.",
    ]);
    expect(serialMessages("void setup() { Serial.begin(115200);\n// Serial2.begin(9600);\n}\nvoid loop() { Serial2.println(1); }", "mega2560")).toEqual([
      "Serial2.begin() is commented out! Serial2 output may not work correctly.",
    ]);
  });

  it("does not warn for a port that is only named in a comment or a string, or only started", () => {
    expect(serialMessages('void setup() { Serial.begin(115200); Serial1.begin(9600); }\n// Serial2.print(1)\nvoid loop() { Serial.println("Serial3.print"); }', "mega2560")).toEqual([]);
    expect(serialMessages("void loop() { Serial3.end(); }", "uno")).toEqual([]);
  });

  it("leaves an object of the sketch's own named Serial1 alone", () => {
    const code = "#include <SoftwareSerial.h>\nSoftwareSerial Serial1(10, 11);\nvoid setup() { Serial.begin(115200); Serial1.begin(9600); }\nvoid loop() { Serial1.println(1); }";
    expect(serialMessages(code, "uno")).toEqual([]);
  });

  it("keeps the 115200 hint for Serial only", () => {
    const code = "void setup() { Serial.begin(9600); Serial1.begin(9600); }\nvoid loop() { Serial.println(1); Serial1.println(2); }";
    expect(serialMessages(code, "mega2560")).toEqual(["Serial.begin(9600) uses wrong baud rate. This simulator expects Serial.begin(115200)."]);
  });
});
